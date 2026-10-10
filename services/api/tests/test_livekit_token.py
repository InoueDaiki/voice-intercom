import json
from collections.abc import Callable

import jwt
import pytest
from conftest import LIVEKIT_API_KEY, LIVEKIT_API_SECRET, auth_headers, http_event

from voice_intercom_api import store
from voice_intercom_api.app import handler

pytestmark = pytest.mark.usefixtures("tables")


@pytest.fixture(autouse=True)
def seed(tables: None) -> None:
    store.create_room("room-1", "ルーム1", ["member-1"])
    for user_id in ["user-1", "member-1", "outsider-1"]:
        store.put_user(user_id, display_name=f"{user_id} さん", language="ja")


def call(body: object, token: str | None) -> dict:
    event = http_event("POST", "/livekit/token", body=body, headers=auth_headers(token))
    return handler(event, None)  # pyright: ignore[reportArgumentType]


def decode(res: dict) -> dict:
    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["server_url"] == "ws://livekit.test:7880"
    return jwt.decode(body["participant_token"], LIVEKIT_API_SECRET, algorithms=["HS256"])


def test_issues_token_to_admin(make_token: Callable[..., str]) -> None:
    # 管理者はメンバーでなくても入れる
    store.put_user("user-1", display_name="太郎", language="en")

    grant = decode(call({"room_name": "room-1"}, make_token()))

    assert grant["iss"] == LIVEKIT_API_KEY
    assert grant["sub"] == "user-1"
    assert grant["name"] == "太郎"
    assert grant["attributes"] == {"language": "en"}
    assert grant["video"]["roomJoin"] is True
    assert grant["video"]["room"] == "room-1"


def test_issues_token_to_member(make_token: Callable[..., str]) -> None:
    token = make_token(sub="member-1", **{"cognito:groups": None})

    grant = decode(call({"room_name": "room-1"}, token))

    assert grant["sub"] == "member-1"
    assert grant["attributes"] == {"language": "ja"}


def test_rejects_non_member(make_token: Callable[..., str]) -> None:
    token = make_token(sub="outsider-1", **{"cognito:groups": []})

    assert call({"room_name": "room-1"}, token)["statusCode"] == 403


def test_unknown_room(make_token: Callable[..., str]) -> None:
    assert call({"room_name": "room-x"}, make_token())["statusCode"] == 404


def test_requires_profile(make_token: Callable[..., str]) -> None:
    # 言語がないと翻訳されないまま入ってしまうので、先にプロフィールを登録させる
    res = call({"room_name": "room-1"}, make_token(sub="new-user"))

    assert res["statusCode"] == 409


def test_requires_token() -> None:
    assert call({"room_name": "room-1"}, None)["statusCode"] == 401


def test_rejects_invalid_token(make_token: Callable[..., str]) -> None:
    assert call({"room_name": "room-1"}, make_token(token_use="id"))["statusCode"] == 401


def test_rejects_agent_token(make_token: Callable[..., str]) -> None:
    token = make_token(sub="mobile", scope="voice-intercom/agent")

    assert call({"room_name": "room-1"}, token)["statusCode"] == 403


@pytest.mark.parametrize("room_name", ["", "a/b", "x" * 65])
def test_validates_room_name(make_token: Callable[..., str], room_name: str) -> None:
    assert call({"room_name": room_name}, make_token())["statusCode"] == 422
