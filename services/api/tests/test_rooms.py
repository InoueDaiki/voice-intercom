import json
from collections.abc import Callable
from typing import Any

import pytest
from conftest import auth_headers, http_event

from voice_intercom_api import migrate_room_members, store
from voice_intercom_api.app import handler

pytestmark = pytest.mark.usefixtures("tables")

Token = Callable[..., str]


@pytest.fixture(autouse=True)
def seed(tables: None) -> None:
    store.create_room("room-a", "A", ["member-1", "member-2"])
    store.create_room("room-b", "B", ["member-2"])


@pytest.fixture
def admin(make_token: Token) -> str:
    return make_token(sub="admin-1")


@pytest.fixture
def member(make_token: Token) -> str:
    return make_token(sub="member-1", **{"cognito:groups": []})


@pytest.fixture
def outsider(make_token: Token) -> str:
    return make_token(sub="outsider-1", **{"cognito:groups": None})


def call(method: str, path: str, token: str | None, body: Any = None) -> tuple[int, Any]:
    event = http_event(method, path, body=body, headers=auth_headers(token))
    res = handler(event, None)  # pyright: ignore[reportArgumentType]
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None


def room_ids(body: dict) -> list[str]:
    return [r["room_id"] for r in body["items"]]


# 一覧


def test_admin_lists_all_rooms(admin: str) -> None:
    status, body = call("GET", "/rooms", admin)

    assert status == 200
    assert room_ids(body) == ["room-a", "room-b"]


def test_member_lists_own_rooms(member: str) -> None:
    status, body = call("GET", "/rooms", member)

    assert status == 200
    assert room_ids(body) == ["room-a"]
    assert body["items"][0]["member_ids"] == ["member-1", "member-2"]


def test_outsider_lists_nothing(outsider: str) -> None:
    assert call("GET", "/rooms", outsider) == (200, {"items": []})


def test_requires_token() -> None:
    assert call("GET", "/rooms", None)[0] == 401


def test_rejects_agent_token(make_token: Token) -> None:
    assert call("GET", "/rooms", make_token(scope="voice-intercom/agent"))[0] == 403


# 作成


def test_admin_creates_room(admin: str) -> None:
    status, body = call(
        "POST", "/rooms", admin, {"room_id": "room-c", "name": "C", "member_ids": ["u1", "u1"]}
    )

    assert status == 201
    assert body["room_id"] == "room-c"
    assert body["name"] == "C"
    assert body["member_ids"] == ["u1"]
    assert body["created_at"] == body["updated_at"]
    assert body["created_at"].endswith("Z")
    assert call("GET", "/rooms/room-c", admin) == (200, body)


def test_member_ids_default_to_empty(admin: str) -> None:
    status, body = call("POST", "/rooms", admin, {"room_id": "room-c", "name": "C"})

    assert status == 201
    assert body["member_ids"] == []


def test_create_conflict(admin: str) -> None:
    status, body = call("POST", "/rooms", admin, {"room_id": "room-a", "name": "A2"})

    assert status == 409
    assert body["statusCode"] == 409
    assert store.get_room("room-a").name == "A"  # pyright: ignore[reportOptionalMemberAccess]


def test_create_requires_admin(member: str) -> None:
    assert call("POST", "/rooms", member, {"room_id": "room-c", "name": "C"})[0] == 403


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"room_id": "a/b", "name": "C"}, id="room_id"),
        pytest.param({"room_id": "room-c", "name": ""}, id="empty-name"),
        pytest.param({"room_id": "room-c", "name": "x" * 101}, id="long-name"),
    ],
)
def test_create_validates(admin: str, body: dict) -> None:
    assert call("POST", "/rooms", admin, body)[0] == 422


# 取得


def test_admin_gets_room(admin: str) -> None:
    status, body = call("GET", "/rooms/room-b", admin)

    assert status == 200
    assert body["name"] == "B"


def test_member_gets_room(member: str) -> None:
    assert call("GET", "/rooms/room-a", member)[0] == 200


def test_non_member_cannot_get_room(member: str) -> None:
    assert call("GET", "/rooms/room-b", member)[0] == 403


def test_get_unknown_room(admin: str, member: str) -> None:
    assert call("GET", "/rooms/room-x", admin)[0] == 404
    assert call("GET", "/rooms/room-x", member)[0] == 404


# 更新


def test_admin_updates_room(admin: str) -> None:
    before = store.get_room("room-a")
    assert before is not None

    status, body = call("PATCH", "/rooms/room-a", admin, {"member_ids": ["member-3"]})

    assert status == 200
    assert body["name"] == "A"
    assert body["member_ids"] == ["member-3"]
    assert body["created_at"] == before.created_at
    assert body["updated_at"] >= before.updated_at

    status, body = call("PATCH", "/rooms/room-a", admin, {"name": "A2"})

    assert status == 200
    assert body["name"] == "A2"
    assert body["member_ids"] == ["member-3"]


def test_member_list_follows_membership(admin: str, member: str) -> None:
    call("PATCH", "/rooms/room-b", admin, {"member_ids": ["member-2", "member-1"]})
    call("PATCH", "/rooms/room-a", admin, {"member_ids": ["member-2"]})

    status, body = call("GET", "/rooms", member)

    assert status == 200
    assert room_ids(body) == ["room-b"]
    # メンバーは user_id の順で返す
    assert body["items"][0]["member_ids"] == ["member-1", "member-2"]


def test_member_list_skips_stale_index(
    admin: str, member: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # GSI に外した後の行が残っていても(結果整合)、ルームのメンバーで確かめて出さない
    call("PATCH", "/rooms/room-a", admin, {"member_ids": ["member-2"]})
    real_query = store._query  # pyright: ignore[reportPrivateUsage]

    def stale_query(table: Any, **kwargs: Any) -> Any:
        if kwargs.get("IndexName") == store.MEMBER_ROOMS_INDEX:
            return iter([{"room_id": "room-a", "user_id": "member-1"}])
        return real_query(table, **kwargs)

    monkeypatch.setattr(store, "_query", stale_query)

    assert call("GET", "/rooms", member) == (200, {"items": []})


def test_update_requires_admin(member: str) -> None:
    assert call("PATCH", "/rooms/room-a", member, {"name": "A2"})[0] == 403


def test_update_unknown_room(admin: str) -> None:
    assert call("PATCH", "/rooms/room-x", admin, {"name": "X"})[0] == 404
    assert store.get_room("room-x") is None


# 削除


def test_admin_deletes_room(admin: str) -> None:
    status, body = call("DELETE", "/rooms/room-a", admin)

    assert (status, body) == (204, None)
    assert store.get_room("room-a") is None
    assert store._member_ids("room-a") == []  # pyright: ignore[reportPrivateUsage]


def test_recreated_room_drops_leftover_members(admin: str, member: str) -> None:
    # ルームを消したときにメンバーの行が残っても(途中で失敗したとき)、一覧に出さず、作り直せば消える
    store._rooms().delete_item(Key={"room_id": "room-a"})  # pyright: ignore[reportPrivateUsage]

    assert call("GET", "/rooms", member) == (200, {"items": []})

    status, body = call("POST", "/rooms", admin, {"room_id": "room-a", "name": "A2"})

    assert status == 201
    assert body["member_ids"] == []
    assert store._member_ids("room-a") == []  # pyright: ignore[reportPrivateUsage]


def test_migrate_member_ids(member: str) -> None:
    # room_members に移す前の形の行(member_ids を rooms の行に持つ)
    store._rooms().put_item(  # pyright: ignore[reportPrivateUsage]
        Item={
            "room_id": "room-old",
            "name": "Old",
            "member_ids": ["member-1", "member-9", "member-1"],
            "created_at": "2026-10-01T00:00:00.000Z",
            "updated_at": "2026-10-01T00:00:00.000Z",
        }
    )

    migrate_room_members.main()
    migrate_room_members.main()  # 2回目は何もしない

    item = store._rooms().get_item(Key={"room_id": "room-old"})["Item"]  # pyright: ignore[reportPrivateUsage]
    assert "member_ids" not in item
    status, body = call("GET", "/rooms", member)
    assert status == 200
    assert room_ids(body) == ["room-a", "room-old"]
    assert body["items"][1]["member_ids"] == ["member-1", "member-9"]


def test_delete_requires_admin(member: str) -> None:
    assert call("DELETE", "/rooms/room-a", member)[0] == 403
    assert store.get_room("room-a") is not None


def test_delete_unknown_room(admin: str) -> None:
    assert call("DELETE", "/rooms/room-x", admin)[0] == 404
