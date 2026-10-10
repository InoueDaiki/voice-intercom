from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import boto3
import pytest
from timeline_env import (
    AGENT_SCOPE,
    MEDIA_BASE_URL,
    MEDIA_BUCKET,
    Token,
    call,
    setup_timeline,
    teardown_timeline,
)

from voice_intercom_api import media_store, store, timeline_store


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
def other_member(make_token: Token) -> str:
    return make_token(sub="member-2", **{"cognito:groups": []})


@pytest.fixture
def outsider(make_token: Token) -> str:
    return make_token(sub="outsider-1", **{"cognito:groups": None})


@pytest.fixture
def agent(make_token: Token) -> str:
    return make_token(sub="agent-client", scope=AGENT_SCOPE, **{"cognito:groups": None})


def create_upload(token: str, room_id: str = "room-a", **overrides: Any) -> tuple[int, Any]:
    body = {"content_type": "image/png", "size_bytes": 3, "has_thumbnail": False} | overrides
    return call("POST", f"/rooms/{room_id}/media/uploads", token, body)


def complete(token: str, media_id: str, body: Any = None, room_id: str = "room-a") -> Any:
    return call("POST", f"/rooms/{room_id}/media/{media_id}/complete", token, body or {})


def put_object(key: str, content_type: str, data: bytes = b"abc") -> None:
    boto3.client("s3").put_object(Bucket=MEDIA_BUCKET, Key=key, Body=data, ContentType=content_type)


def signed(url: str) -> tuple[str, dict[str, list[str]]]:
    parsed = urlparse(url)
    return parsed.path, parse_qs(parsed.query)


# 署名付き URL の発行


def test_member_creates_upload(member: str) -> None:
    status, body = create_upload(member, has_thumbnail=True)

    assert status == 200
    media_id = body["media_id"]
    assert len(media_id) == 32
    assert body["expires_at"].endswith("Z")

    path, query = signed(body["upload_url"])
    assert path.endswith(f"rooms/room-a/{media_id}/original")
    assert query["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    # Content-Type を署名に含める(違う Content-Type の PUT は S3 が 403 にする)
    assert "content-type" in query["X-Amz-SignedHeaders"][0].split(";")
    assert query["X-Amz-Expires"] == ["3600"]

    path, query = signed(body["thumbnail_upload_url"])
    assert path.endswith(f"rooms/room-a/{media_id}/thumbnail")
    assert "content-type" in query["X-Amz-SignedHeaders"][0].split(";")


def test_signature_depends_on_content_type() -> None:
    # 同じキーでも Content-Type が違えば署名が変わる(= Content-Type が署名に入っている)

    png = signed(media_store.presign_put("rooms/room-a/x/original", "image/png"))[1]
    jpeg = signed(media_store.presign_put("rooms/room-a/x/original", "image/jpeg"))[1]

    assert png["X-Amz-Signature"] != jpeg["X-Amz-Signature"]


def test_upload_without_thumbnail(member: str) -> None:
    status, body = create_upload(member, content_type="video/mp4")

    assert status == 200
    assert body["thumbnail_upload_url"] is None


def test_admin_creates_upload(admin: str) -> None:
    assert create_upload(admin, room_id="room-b")[0] == 200


def test_non_member_cannot_upload(member: str, outsider: str, agent: str) -> None:
    assert create_upload(member, room_id="room-b")[0] == 403
    assert create_upload(outsider)[0] == 403
    assert create_upload(agent)[0] == 403


def test_upload_unknown_room(admin: str) -> None:
    assert create_upload(admin, room_id="room-x")[0] == 404


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"content_type": "image/gif"}, id="content_type"),
        pytest.param({"content_type": "video/quicktime"}, id="mov"),
        pytest.param({"size_bytes": 0}, id="empty"),
        pytest.param({"size_bytes": 100 * 1024 * 1024 + 1}, id="too-large"),
    ],
)
def test_upload_validates(member: str, overrides: dict[str, Any]) -> None:
    assert create_upload(member, **overrides)[0] == 422


def test_upload_accepts_limit(member: str) -> None:
    assert create_upload(member, size_bytes=100 * 1024 * 1024)[0] == 200


# complete


def test_complete(member: str, other_member: str) -> None:
    store.put_user("member-1", display_name="Taro", language="ja")
    _, upload = create_upload(member, has_thumbnail=True)
    media_id = upload["media_id"]
    put_object(f"rooms/room-a/{media_id}/original", "image/png", b"abcd")
    put_object(f"rooms/room-a/{media_id}/thumbnail", "image/jpeg")

    status, event = complete(member, media_id, {"text": "現場の写真"})

    assert status == 200
    assert event["kind"] == "media"
    assert event["room_id"] == "room-a"
    assert event["sender_id"] == "member-1"
    assert event["event_id"] == f"{event['occurred_at']}#{media_id}"
    assert event["occurred_at"].endswith("Z")
    assert event["text"] == "現場の写真"
    assert event["language"] == "ja"
    assert event["translations"] == {}
    assert event["utterance_id"] is None
    assert event["segment_index"] is None
    assert event["media"] == {
        "media_id": media_id,
        "content_type": "image/png",
        "url": f"{MEDIA_BASE_URL}/rooms/room-a/{media_id}/original",
        "thumbnail_url": f"{MEDIA_BASE_URL}/rooms/room-a/{media_id}/thumbnail",
        # 宣言した大きさではなく、置かれた大きさ
        "size_bytes": 4,
    }

    # ルームの他のメンバーにも履歴として見える
    _, page = call("GET", "/rooms/room-a/timeline", other_member)
    assert page["items"] == [event]


def test_complete_without_thumbnail(member: str) -> None:
    _, upload = create_upload(member, content_type="video/mp4")
    media_id = upload["media_id"]
    put_object(f"rooms/room-a/{media_id}/original", "video/mp4")

    status, event = complete(member, media_id)

    assert status == 200
    assert event["text"] == ""
    # プロフィールがなければ言語は分からない
    assert event["language"] is None
    assert event["media"]["thumbnail_url"] is None


def test_complete_is_idempotent(member: str, admin: str) -> None:
    _, upload = create_upload(member)
    media_id = upload["media_id"]
    put_object(f"rooms/room-a/{media_id}/original", "image/png")

    first = complete(member, media_id, {"text": "a"})
    second = complete(member, media_id, {"text": "a"})

    assert first[0] == 200
    assert first == second
    _, page = call("GET", "/rooms/room-a/timeline", admin)
    assert len(page["items"]) == 1


def test_concurrent_complete_returns_first_event(member: str) -> None:
    _, upload = create_upload(member)
    media_id = upload["media_id"]
    put_object(f"rooms/room-a/{media_id}/original", "image/png")
    pending = timeline_store.get_pending_upload("room-a", media_id)
    assert pending is not None

    # 仮の行を読んだ後に、別の complete が先に書いた場合
    first = timeline_store.complete_upload(
        pending,
        sender_id="member-1",
        occurred_at="2026-10-10T00:00:00.000Z",
        language=None,
        text="",
    )
    with pytest.raises(timeline_store.AlreadyCompletedError) as e:
        timeline_store.complete_upload(
            pending,
            sender_id="member-1",
            occurred_at="2026-10-10T00:00:01.000Z",
            language=None,
            text="",
        )

    assert e.value.event_id == first.event_id
    assert timeline_store.list_events("room-a", limit=10, before=None)[0] == [first]


def test_complete_before_upload(member: str) -> None:
    _, upload = create_upload(member)

    status, body = complete(member, upload["media_id"])

    assert status == 409
    assert body["statusCode"] == 409
    assert timeline_store.list_events("room-a", limit=10, before=None) == ([], None)


def test_complete_without_uploaded_thumbnail(member: str) -> None:
    _, upload = create_upload(member, has_thumbnail=True)
    media_id = upload["media_id"]
    put_object(f"rooms/room-a/{media_id}/original", "image/png")

    assert complete(member, media_id)[0] == 409

    put_object(f"rooms/room-a/{media_id}/thumbnail", "image/jpeg")

    assert complete(member, media_id)[0] == 200


def test_only_uploader_completes(member: str, other_member: str, admin: str) -> None:
    _, upload = create_upload(member)
    media_id = upload["media_id"]
    put_object(f"rooms/room-a/{media_id}/original", "image/png")

    # 同じルームのメンバーでも、管理者でも、本人でなければ 403
    assert complete(other_member, media_id)[0] == 403
    assert complete(admin, media_id)[0] == 403
    assert timeline_store.list_events("room-a", limit=10, before=None) == ([], None)


def test_complete_requires_membership(member: str, outsider: str, agent: str) -> None:
    _, upload = create_upload(member)
    media_id = upload["media_id"]

    assert complete(outsider, media_id)[0] == 403
    assert complete(agent, media_id)[0] == 403


def test_complete_unknown_media(member: str) -> None:
    assert complete(member, "0" * 32)[0] == 404
    # 別のルームの media_id は、そのルームにはない
    _, upload = create_upload(member)
    store.update_room("room-b", name=None, member_ids=["member-1"])
    assert complete(member, upload["media_id"], room_id="room-b")[0] == 404


def test_complete_unknown_room(member: str) -> None:
    assert complete(member, "0" * 32, room_id="room-x")[0] == 404


def test_complete_validates_media_id(member: str) -> None:
    assert complete(member, "not-a-media-id")[0] == 422


def test_pending_upload_is_hidden_from_timeline(member: str) -> None:
    create_upload(member)

    assert call("GET", "/rooms/room-a/timeline", member)[1] == {"items": [], "next_before": None}
