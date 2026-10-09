import json
from collections.abc import Callable

import jwt
import pytest
from conftest import LIVEKIT_API_KEY, LIVEKIT_API_SECRET, http_event

from voice_intercom_api.app import handler

pytestmark = pytest.mark.usefixtures("env")


def call(body: object, token: str | None) -> dict:
    headers = {"authorization": f"Bearer {token}"} if token else {}
    return handler(http_event("POST", "/livekit/token", body=body, headers=headers), None)  # pyright: ignore[reportArgumentType]


def test_issues_token(make_token: Callable[..., str]) -> None:
    res = call({"room_name": "room-1"}, make_token())

    assert res["statusCode"] == 200
    body = json.loads(res["body"])
    assert body["server_url"] == "ws://livekit.test:7880"
    grant = jwt.decode(body["participant_token"], LIVEKIT_API_SECRET, algorithms=["HS256"])
    assert grant["iss"] == LIVEKIT_API_KEY
    assert grant["sub"] == "user-1"
    assert grant["video"]["roomJoin"] is True
    assert grant["video"]["room"] == "room-1"


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
