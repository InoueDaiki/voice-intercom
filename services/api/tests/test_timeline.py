from collections.abc import Iterator
from typing import Any

import pytest
from timeline_env import AGENT_SCOPE, Token, call, setup_timeline, teardown_timeline

from voice_intercom_api import timeline_store


@pytest.fixture(autouse=True)
def timeline(tables: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    setup_timeline(monkeypatch)
    yield
    teardown_timeline()


@pytest.fixture
def admin(make_token: Token) -> str:
    return make_token(sub="admin-1")


@pytest.fixture
def member(make_token: Token) -> str:
    return make_token(sub="member-1", **{"cognito:groups": []})


@pytest.fixture
def outsider(make_token: Token) -> str:
    return make_token(sub="outsider-1", **{"cognito:groups": None})


@pytest.fixture
def agent(make_token: Token) -> str:
    return make_token(sub="agent-client", scope=AGENT_SCOPE, **{"cognito:groups": None})


def utterance(**overrides: Any) -> dict[str, Any]:
    return {
        "kind": "utterance",
        "sender_id": "member-1",
        "occurred_at": "2026-10-10T00:00:00.000Z",
        "language": "ja",
        "text": "こんにちは",
        "translations": {"en": "Hello"},
        "utterance_id": "utt-1",
        "segment_index": 0,
    } | overrides


def put(token: str, source_id: str, body: dict[str, Any], room_id: str = "room-a") -> Any:
    return call("PUT", f"/rooms/{room_id}/timeline/{source_id}", token, body)


# 保存(Agent)


def test_agent_puts_utterance(agent: str, member: str) -> None:
    status, body = put(agent, "seg-1", utterance())

    assert status == 200
    assert body == {
        "room_id": "room-a",
        "event_id": "2026-10-10T00:00:00.000Z#seg-1",
        "kind": "utterance",
        "sender_id": "member-1",
        "occurred_at": "2026-10-10T00:00:00.000Z",
        "language": "ja",
        "text": "こんにちは",
        "translations": {"en": "Hello"},
        "utterance_id": "utt-1",
        "segment_index": 0,
        "media": None,
    }
    assert call("GET", "/rooms/room-a/timeline", member) == (
        200,
        {"items": [body], "next_before": None},
    )


def test_agent_puts_text(agent: str) -> None:
    status, body = put(
        agent,
        "msg-1",
        {
            "kind": "text",
            "sender_id": "member-2",
            "occurred_at": "2026-10-10T09:00:00.5+09:00",
            "language": None,
            "text": "hi",
            "translations": {},
        },
    )

    assert status == 200
    # 時刻は UTC・ミリ秒にそろえてから event_id にする
    assert body["occurred_at"] == "2026-10-10T00:00:00.500Z"
    assert body["event_id"] == "2026-10-10T00:00:00.500Z#msg-1"
    assert body["language"] is None
    assert body["utterance_id"] is None
    assert body["segment_index"] is None


def test_put_is_idempotent(agent: str, admin: str) -> None:
    first = put(agent, "seg-1", utterance())
    second = put(agent, "seg-1", utterance())

    assert first == second
    status, page = call("GET", "/rooms/room-a/timeline", admin)
    assert status == 200
    assert [e["event_id"] for e in page["items"]] == ["2026-10-10T00:00:00.000Z#seg-1"]


def test_put_replaces_same_event(agent: str, admin: str) -> None:
    put(agent, "seg-1", utterance(translations={}))
    put(agent, "seg-1", utterance(translations={"en": "Hello", "ko": "안녕하세요"}))

    _, page = call("GET", "/rooms/room-a/timeline", admin)
    assert len(page["items"]) == 1
    assert page["items"][0]["translations"] == {"en": "Hello", "ko": "안녕하세요"}


@pytest.mark.parametrize("who", ["admin", "member", "outsider"])
def test_put_requires_agent(who: str, request: pytest.FixtureRequest) -> None:
    token = request.getfixturevalue(who)

    assert put(token, "seg-1", utterance())[0] == 403
    assert timeline_store.list_events("room-a", limit=10, before=None) == ([], None)


def test_put_requires_token() -> None:
    assert call("PUT", "/rooms/room-a/timeline/seg-1", None, utterance())[0] == 401


def test_put_unknown_room(agent: str) -> None:
    assert put(agent, "seg-1", utterance(), room_id="room-x")[0] == 404


@pytest.mark.parametrize(
    ("source_id", "body"),
    [
        pytest.param("a.b", utterance(), id="source_id"),
        pytest.param("x" * 129, utterance(), id="long-source_id"),
        pytest.param("seg-1", utterance(kind="media"), id="kind-media"),
        pytest.param("seg-1", utterance(occurred_at="2026-10-10T00:00:00"), id="naive-time"),
        pytest.param("seg-1", utterance(occurred_at="yesterday"), id="bad-time"),
        pytest.param("seg-1", utterance(language="xx"), id="language"),
        pytest.param("seg-1", utterance(kind="text"), id="text-with-utterance-id"),
        pytest.param("seg-1", utterance(segment_index=-1), id="segment_index"),
    ],
)
def test_put_validates(agent: str, source_id: str, body: dict[str, Any]) -> None:
    assert put(agent, source_id, body)[0] == 422


# 一覧


def test_member_reads_timeline(member: str) -> None:
    expected = {"items": [], "next_before": None}
    assert call("GET", "/rooms/room-a/timeline", member) == (200, expected)


def test_admin_reads_any_timeline(admin: str) -> None:
    assert call("GET", "/rooms/room-b/timeline", admin)[0] == 200


def test_non_member_cannot_read(member: str, outsider: str) -> None:
    assert call("GET", "/rooms/room-b/timeline", member)[0] == 403
    assert call("GET", "/rooms/room-a/timeline", outsider)[0] == 403


def test_agent_cannot_read(agent: str) -> None:
    assert call("GET", "/rooms/room-a/timeline", agent)[0] == 403


def test_read_unknown_room(admin: str, member: str) -> None:
    assert call("GET", "/rooms/room-x/timeline", admin)[0] == 404
    assert call("GET", "/rooms/room-x/timeline", member)[0] == 404


def test_rooms_are_separate(agent: str, member: str) -> None:
    put(agent, "seg-1", utterance(), room_id="room-b")

    assert call("GET", "/rooms/room-a/timeline", member)[1]["items"] == []


def test_paging(agent: str, member: str) -> None:
    for i in range(5):
        put(agent, f"seg-{i}", utterance(occurred_at=f"2026-10-10T00:00:0{i}.000Z"))

    status, page = call("GET", "/rooms/room-a/timeline", member, query={"limit": "2"})
    assert status == 200
    # 新しい順
    assert [e["event_id"] for e in page["items"]] == [
        "2026-10-10T00:00:04.000Z#seg-4",
        "2026-10-10T00:00:03.000Z#seg-3",
    ]
    assert page["next_before"] == "2026-10-10T00:00:03.000Z#seg-3"

    _, page = call(
        "GET",
        "/rooms/room-a/timeline",
        member,
        query={"limit": "2", "before": page["next_before"]},
    )
    assert [e["event_id"] for e in page["items"]] == [
        "2026-10-10T00:00:02.000Z#seg-2",
        "2026-10-10T00:00:01.000Z#seg-1",
    ]

    _, page = call(
        "GET",
        "/rooms/room-a/timeline",
        member,
        query={"limit": "2", "before": page["next_before"]},
    )
    assert [e["event_id"] for e in page["items"]] == ["2026-10-10T00:00:00.000Z#seg-0"]
    assert page["next_before"] is None


def test_exact_page_has_no_next(agent: str, member: str) -> None:
    for i in range(2):
        put(agent, f"seg-{i}", utterance(occurred_at=f"2026-10-10T00:00:0{i}.000Z"))

    _, page = call("GET", "/rooms/room-a/timeline", member, query={"limit": "2"})

    assert len(page["items"]) == 2
    assert page["next_before"] is None


def test_default_limit(agent: str, member: str) -> None:
    for i in range(51):
        put(agent, f"seg-{i:02}", utterance(occurred_at=f"2026-10-10T00:00:{i:02}.000Z"))

    _, page = call("GET", "/rooms/room-a/timeline", member)

    assert len(page["items"]) == 50
    assert page["next_before"] == "2026-10-10T00:00:01.000Z#seg-01"


@pytest.mark.parametrize("limit", ["0", "101", "x"])
def test_limit_range(member: str, limit: str) -> None:
    assert call("GET", "/rooms/room-a/timeline", member, query={"limit": limit})[0] == 422
