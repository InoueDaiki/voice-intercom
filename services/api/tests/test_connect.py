"""Connect の申請(connect.py)と、テナントの API(tenants.py)。"""

import json
from collections.abc import Callable
from typing import Any

import pytest
from conftest import auth_headers, http_event

from voice_intercom_api import room_cleanup, store
from voice_intercom_api.app import handler

pytestmark = pytest.mark.usefixtures("tables")

Token = Callable[..., str]

USERS = {
    "admin-1": "t1",
    "member-1": "t1",
    "admin-2": "t2",
    "member-2": "t2",
    "admin-3": "t3",
}


@pytest.fixture(autouse=True)
def seed(tables: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(room_cleanup, "after_delete", lambda _room_id: None)
    monkeypatch.setattr(room_cleanup, "evict", lambda _room_id, ids: ids)
    for tenant_id, name in [("t1", "現場1"), ("t2", "協力会社"), ("t3", "別の会社")]:
        store.create_tenant(tenant_id, name)
    for user_id, tenant_id in USERS.items():
        store.put_user(user_id, display_name=f"{user_id} さん", language="ja")
        store.set_user_tenant(user_id, tenant_id)


@pytest.fixture
def token(make_token: Token) -> Callable[[str], str]:
    def make(user_id: str) -> str:
        groups = ["admin"] if user_id.startswith("admin") else []
        return make_token(sub=user_id, **{"cognito:groups": groups})

    return make


def call(
    method: str, path: str, token: str | None, body: Any = None, **query: str
) -> tuple[int, Any]:
    event = http_event(method, path, body=body, headers=auth_headers(token))
    if query:
        event["rawQueryString"] = "&".join(f"{k}={v}" for k, v in query.items())
        event["queryStringParameters"] = query
    res = handler(event, None)  # pyright: ignore[reportArgumentType]
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None


def request(token: str, tenant_id: str = "t2", name: str = "合同") -> tuple[int, Any]:
    return call("POST", "/connect-requests", token, {"tenant_id": tenant_id, "name": name})


# 申請


def test_admin_requests_connect(token: Callable[[str], str]) -> None:
    status, body = request(token("admin-1"))

    assert status == 201
    assert body["direction"] == "outgoing"
    assert body["from_tenant_name"] == "現場1"
    assert body["to_tenant_name"] == "協力会社"
    room = body["room"]
    assert room["kind"] == "connect"
    assert room["connect_status"] == "pending"
    assert (room["tenant_id"], room["connect_tenant_id"]) == ("t1", "t2")
    # 申請した人がオーナーになる
    assert room["owner_ids"] == ["admin-1"]


def test_request_validates_target(token: Callable[[str], str]) -> None:
    assert request(token("admin-1"), tenant_id="t1")[0] == 400
    assert request(token("admin-1"), tenant_id="nothing")[0] == 404
    assert request(token("member-1"))[0] == 403


def test_both_sides_see_request(token: Callable[[str], str]) -> None:
    room_id = request(token("admin-1"))[1]["room"]["room_id"]

    _, outgoing = call("GET", "/connect-requests", token("admin-1"))
    _, incoming = call("GET", "/connect-requests", token("admin-2"))
    _, unrelated = call("GET", "/connect-requests", token("admin-3"))

    assert [(r["room"]["room_id"], r["direction"]) for r in outgoing["items"]] == [
        (room_id, "outgoing")
    ]
    assert [(r["room"]["room_id"], r["direction"]) for r in incoming["items"]] == [
        (room_id, "incoming")
    ]
    assert unrelated == {"items": []}


def test_pending_room_is_not_usable(token: Callable[[str], str]) -> None:
    room_id = request(token("admin-1"))[1]["room"]["room_id"]

    # 申請中は、メンバーの一覧に出さず、入れず、メンバーも変えられない
    assert call("GET", "/rooms", token("admin-1")) == (200, {"items": []})
    assert call("POST", "/livekit/token", token("admin-1"), {"room_name": room_id})[0] == 409
    assert call("PUT", f"/rooms/{room_id}/members/member-1", token("admin-1"), {})[0] == 409


# 受ける・断る


def test_other_side_accepts(token: Callable[[str], str]) -> None:
    room_id = request(token("admin-1"))[1]["room"]["room_id"]

    # 申請した側は受けられない。関係の無いテナントには見えない
    assert call("POST", f"/connect-requests/{room_id}/accept", token("admin-1"))[0] == 403
    assert call("POST", f"/connect-requests/{room_id}/accept", token("admin-3"))[0] == 404

    status, room = call("POST", f"/connect-requests/{room_id}/accept", token("admin-2"))

    assert status == 200
    assert room["connect_status"] == "active"
    # 受けた人もオーナーになる
    assert room["owner_ids"] == ["admin-1", "admin-2"]
    assert call("GET", "/connect-requests", token("admin-2")) == (200, {"items": []})
    # 両方のテナントの管理者の一覧に出る
    for admin in ["admin-1", "admin-2"]:
        _, rooms = call("GET", "/rooms", token(admin), scope="tenant")
        assert [r["room_id"] for r in rooms["items"]] == [room_id]
    assert call("GET", "/rooms", token("admin-3"), scope="tenant") == (200, {"items": []})


def test_each_side_manages_own_members(token: Callable[[str], str]) -> None:
    room_id = request(token("admin-1"))[1]["room"]["room_id"]
    call("POST", f"/connect-requests/{room_id}/accept", token("admin-2"))
    members = f"/rooms/{room_id}/members"

    assert call("PUT", f"{members}/member-1", token("admin-1"), {})[0] == 200
    assert call("PUT", f"{members}/member-2", token("admin-2"), {})[0] == 200
    # 相手のテナントの人は足せない・変えられない・外せない
    assert call("PUT", f"{members}/member-2", token("admin-1"), {"role": "owner"})[0] == 403
    assert call("DELETE", f"{members}/member-1", token("admin-2"))[0] == 403
    assert call("PUT", f"{members}/member-3", token("admin-2"), {})[0] == 400

    _, body = call("GET", members, token("member-2"))
    assert [(m["user_id"], m["role"], m["tenant_id"]) for m in body["items"]] == [
        ("admin-1", "owner", "t1"),
        ("admin-2", "owner", "t2"),
        ("member-1", "member", "t1"),
        ("member-2", "member", "t2"),
    ]
    # どちらのテナントの人も入れる
    for user_id in ["member-1", "member-2"]:
        assert call("POST", "/livekit/token", token(user_id), {"room_name": room_id})[0] == 200


def test_decline_and_cancel(token: Callable[[str], str]) -> None:
    first = request(token("admin-1"))[1]["room"]["room_id"]
    second = request(token("admin-1"))[1]["room"]["room_id"]

    assert call("DELETE", f"/connect-requests/{first}", token("admin-3"))[0] == 404
    assert call("DELETE", f"/connect-requests/{first}", token("admin-2"))[0] == 204
    assert call("DELETE", f"/connect-requests/{second}", token("admin-1"))[0] == 204
    assert store.get_room(first) is None
    assert store.get_room(second) is None
    assert call("DELETE", f"/connect-requests/{first}", token("admin-1"))[0] == 404


def test_active_room_is_not_a_request(token: Callable[[str], str]) -> None:
    room_id = request(token("admin-1"))[1]["room"]["room_id"]
    call("POST", f"/connect-requests/{room_id}/accept", token("admin-2"))

    assert call("DELETE", f"/connect-requests/{room_id}", token("admin-2"))[0] == 404
    assert call("POST", f"/connect-requests/{room_id}/accept", token("admin-2"))[0] == 404


# テナント(運営者)


@pytest.fixture
def operator(make_token: Token) -> str:
    return make_token(sub="operator-1", **{"cognito:groups": ["operator"]})


def test_operator_creates_tenant(operator: str) -> None:
    status, body = call("POST", "/tenants", operator, {"tenant_id": "acme-01", "name": "ACME"})

    assert status == 201
    assert (body["tenant_id"], body["name"]) == ("acme-01", "ACME")
    assert call("POST", "/tenants", operator, {"tenant_id": "acme-01", "name": "x"})[0] == 409
    _, tenants = call("GET", "/tenants", operator)
    assert [t["tenant_id"] for t in tenants["items"]] == ["acme-01", "t1", "t2", "t3"]


@pytest.mark.parametrize("tenant_id", ["a", "Acme", "-acme", "acme-", "a_b", "x" * 33])
def test_tenant_id_pattern(operator: str, tenant_id: str) -> None:
    assert call("POST", "/tenants", operator, {"tenant_id": tenant_id, "name": "x"})[0] == 422


def test_operator_sets_user_tenant(operator: str) -> None:
    status, body = call("PUT", "/users/member-1/tenant", operator, {"tenant_id": "t2"})

    assert status == 200
    assert body["tenant_id"] == "t2"
    assert store.tenant_of("member-1") == "t2"

    assert (
        call("PUT", "/users/member-1/tenant", operator, {"tenant_id": None})[1]["tenant_id"] is None
    )
    assert call("PUT", "/users/member-1/tenant", operator, {"tenant_id": "nothing"})[0] == 404
    assert call("PUT", "/users/ghost/tenant", operator, {"tenant_id": "t1"})[0] == 404


def test_tenant_api_requires_operator(token: Callable[[str], str]) -> None:
    admin = token("admin-1")

    assert call("GET", "/tenants", admin)[0] == 403
    assert call("POST", "/tenants", admin, {"tenant_id": "acme", "name": "x"})[0] == 403
    assert call("PUT", "/users/member-1/tenant", admin, {"tenant_id": "t1"})[0] == 403


def test_deleting_connect_room_is_listed_only_for_creating_tenant(
    token: Callable[[str], str],
) -> None:
    _, created = request(token("admin-1"))
    room_id = created["room"]["room_id"]
    call("POST", f"/connect-requests/{room_id}/accept", token("admin-2"))
    store.update_room(room_id, deleting_at=store.now())

    assert [r.room_id for r in store.list_tenant_rooms("t1")] == [room_id]
    # 相手のテナントは DELETE をやり直せないので、一覧に出さない
    assert store.list_tenant_rooms("t2") == []


def test_deleting_request_is_not_listed(token: Callable[[str], str]) -> None:
    _, created = request(token("admin-1"))
    store.update_room(created["room"]["room_id"], deleting_at=store.now())

    assert call("GET", "/connect-requests", token("admin-1"))[1]["items"] == []
    assert call("GET", "/connect-requests", token("admin-2"))[1]["items"] == []
