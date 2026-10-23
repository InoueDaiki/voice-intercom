import json
from collections.abc import Callable
from typing import Any

import boto3
import pytest
from conftest import USERS_TABLE, auth_headers, http_event

from voice_intercom_api import device_store
from voice_intercom_api.app import handler
from voice_intercom_api.device_store import Device
from voice_intercom_api.openapi import render

pytestmark = pytest.mark.usefixtures("tables")

Token = Callable[..., str]

# FCM のトークンは `:` を含む長い文字列
FCM_TOKEN = "fGx1:APA91b" + "x" * 140


@pytest.fixture(autouse=True)
def clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # 登録の順が updated_at に表れるよう、呼ぶたびに1秒進める(ミリ秒では同じ時刻になりうる)
    ticks = iter(range(1_000_000))
    monkeypatch.setattr(device_store.store, "now", lambda: f"2026-01-01T00:00:00Z+{next(ticks):07}")


@pytest.fixture
def member(make_token: Token) -> str:
    return make_token(sub="member-1", **{"cognito:groups": []})


@pytest.fixture
def other(make_token: Token) -> str:
    return make_token(sub="member-2", **{"cognito:groups": []})


def call(method: str, path: str, token: str | None, body: Any = None) -> tuple[int, Any]:
    event = http_event(method, path, body=body, headers=auth_headers(token))
    res = handler(event, None)  # pyright: ignore[reportArgumentType]
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None


def users_table() -> Any:
    return boto3.resource("dynamodb").Table(USERS_TABLE)  # pyright: ignore[reportAttributeAccessIssue]


def tokens_of(user_id: str) -> list[str]:
    return [d.token for d in device_store.list_devices([user_id])]


def register(token: str, platform: str = "android", user: str = "") -> int:
    return call("PUT", "/users/me/devices", user, {"token": token, "platform": platform})[0]


def test_register_and_unregister(member: str) -> None:
    assert register(FCM_TOKEN, "ios", member) == 204
    assert device_store.list_devices(["member-1"]) == [Device("member-1", FCM_TOKEN, "ios")]

    assert call("DELETE", "/users/me/devices", member, {"token": FCM_TOKEN}) == (204, None)
    assert tokens_of("member-1") == []


def test_unregister_unknown_token(member: str) -> None:
    # ログアウトを失敗させない。項目も作らない
    assert call("DELETE", "/users/me/devices", member, {"token": FCM_TOKEN})[0] == 204
    assert "Item" not in users_table().get_item(Key={"user_id": "member-1"})


def test_register_twice_updates(member: str) -> None:
    register(FCM_TOKEN, "ios", member)
    register(FCM_TOKEN, "android", member)

    assert device_store.list_devices(["member-1"]) == [Device("member-1", FCM_TOKEN, "android")]


def test_multiple_devices(member: str) -> None:
    register("token-a", "ios", member)
    register("token-b", "android", member)

    assert tokens_of("member-1") == ["token-a", "token-b"]


def test_limit_evicts_oldest(member: str) -> None:
    for i in range(device_store.MAX_DEVICES):
        register(f"token-{i:02}", "android", member)
    # 0番を登録し直すと、いちばん古いのは1番になる
    register("token-00", "android", member)

    register("token-new", "android", member)

    tokens = tokens_of("member-1")
    assert len(tokens) == device_store.MAX_DEVICES
    assert "token-01" not in tokens
    assert tokens[-2:] == ["token-00", "token-new"]


def test_token_moves_to_new_owner(member: str, other: str) -> None:
    register(FCM_TOKEN, "ios", member)
    register("token-kept", "ios", member)

    register(FCM_TOKEN, "ios", other)

    assert tokens_of("member-1") == ["token-kept"]
    assert tokens_of("member-2") == [FCM_TOKEN]


def test_profile_and_devices_coexist(member: str, make_token: Token) -> None:
    # 端末だけを先に登録しても、プロフィールは未登録のまま
    register(FCM_TOKEN, "ios", member)
    assert call("GET", "/users/me", member)[0] == 404
    operator = make_token(sub="operator-1", **{"cognito:groups": ["operator"]})
    assert call("GET", "/users", operator)[1] == {"items": []}

    # プロフィールの更新で端末は消えず、端末の登録でプロフィールは消えない
    call("PUT", "/users/me", member, {"display_name": "花子", "language": "ja"})
    register("token-2", "android", member)

    assert call("GET", "/users/me", member)[1]["display_name"] == "花子"
    assert tokens_of("member-1") == [FCM_TOKEN, "token-2"]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"token": "", "platform": "ios"}, id="empty"),
        pytest.param({"token": "a b", "platform": "ios"}, id="space"),
        pytest.param({"token": "x" * 4097, "platform": "ios"}, id="long"),
        pytest.param({"token": FCM_TOKEN, "platform": "web"}, id="platform"),
        pytest.param({"token": FCM_TOKEN}, id="no-platform"),
    ],
)
def test_register_validates(member: str, body: dict) -> None:
    assert call("PUT", "/users/me/devices", member, body)[0] == 422


def test_devices_require_user(make_token: Token) -> None:
    body = {"token": FCM_TOKEN, "platform": "ios"}
    assert call("PUT", "/users/me/devices", None, body)[0] == 401
    agent = make_token(sub="agent", scope="voice-intercom/agent", **{"cognito:groups": None})
    assert call("PUT", "/users/me/devices", agent, body)[0] == 403
    assert call("DELETE", "/users/me/devices", agent, {"token": FCM_TOKEN})[0] == 403


def test_list_devices_of_many_users() -> None:
    for i in range(150):
        device_store.register(f"user-{i:03}", f"token-{i:03}", "android")

    devices = device_store.list_devices([f"user-{i:03}" for i in range(150)] + ["nobody"])

    assert [d.token for d in devices] == [f"token-{i:03}" for i in range(150)]


def test_error_schema_ref_resolves() -> None:
    # devices.py はエラーの本文の型を名前で参照するので、app.py の側にあるか確かめる
    spec = json.loads(render())
    assert "ErrorResponse" in spec["components"]["schemas"]
