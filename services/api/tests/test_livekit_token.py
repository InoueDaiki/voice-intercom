import json
from collections.abc import Callable

import boto3
import jwt
import pytest
from conftest import LIVEKIT_API_KEY, LIVEKIT_API_SECRET, auth_headers, http_event

from voice_intercom_api import agent_wake, store
from voice_intercom_api.app import handler

pytestmark = pytest.mark.usefixtures("tables")


@pytest.fixture(autouse=True)
def seed(tables: None) -> None:
    store.create_room("room-1", "ルーム1", ["member-1", "user-1"], tenant_id="t1")
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


def test_issues_token(make_token: Callable[..., str]) -> None:
    store.put_user("user-1", display_name="太郎", language="en")

    grant = decode(call({"room_name": "room-1"}, make_token()))

    assert grant["iss"] == LIVEKIT_API_KEY
    assert grant["sub"] == "user-1"
    assert grant["name"] == "太郎"
    # 前のアプリは audio を送らないので、音声をつなぐとみなす
    assert grant["attributes"] == {"language": "en", "audio": "on"}
    # 自分の属性(表示名や言語)は変えさせない
    assert "canUpdateOwnMetadata" not in grant["video"]
    assert grant["video"]["roomJoin"] is True
    assert grant["video"]["room"] == "room-1"
    # ルームを作るときに Agent を呼ぶ
    assert grant["roomConfig"]["agents"] == [{"agentName": "voice-intercom"}]


def test_issues_token_to_member(make_token: Callable[..., str]) -> None:
    token = make_token(sub="member-1", **{"cognito:groups": None})

    grant = decode(call({"room_name": "room-1", "audio": False}, token))

    assert grant["sub"] == "member-1"
    # データだけでつなぐ(ルームの画面を開いているだけ)
    assert grant["attributes"] == {"language": "ja", "audio": "off"}


def test_admin_needs_membership(make_token: Callable[..., str]) -> None:
    store.put_user("admin-2", display_name="管理者", language="ja")

    assert call({"room_name": "room-1"}, make_token(sub="admin-2"))["statusCode"] == 403


def test_archived_room(make_token: Callable[..., str]) -> None:
    store.update_room("room-1", archived_at=store.now())

    assert call({"room_name": "room-1"}, make_token())["statusCode"] == 409


def test_rejects_non_member(make_token: Callable[..., str]) -> None:
    token = make_token(sub="outsider-1", **{"cognito:groups": []})

    assert call({"room_name": "room-1"}, token)["statusCode"] == 403


def test_unknown_room(make_token: Callable[..., str]) -> None:
    assert call({"room_name": "room-x"}, make_token())["statusCode"] == 404


def test_requires_profile(make_token: Callable[..., str]) -> None:
    # 言語がないと翻訳されないまま入ってしまうので、先にプロフィールを登録させる
    store.put_member("room-1", "new-user", role="member", tenant_id="t1")
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


# dev の scale to zero: 0 台の Agent を起こす(agent_wake.py)


def make_agent_service(desired: int) -> None:
    ecs = boto3.client("ecs")
    ecs.create_cluster(clusterName="agent")
    ecs.register_task_definition(
        family="agent", containerDefinitions=[{"name": "agent", "image": "x", "memory": 512}]
    )
    ecs.create_service(
        cluster="agent", serviceName="agent", taskDefinition="agent", desiredCount=desired
    )


def desired_count() -> int:
    res = boto3.client("ecs").describe_services(cluster="agent", services=["agent"])
    return res["services"][0]["desiredCount"]


@pytest.fixture
def wake_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_ECS_CLUSTER", "agent")
    monkeypatch.setenv("AGENT_ECS_SERVICE", "agent")
    agent_wake._ecs.cache_clear()  # pyright: ignore[reportPrivateUsage]


def test_wakes_agent_from_zero(make_token: Callable[..., str], wake_env: None) -> None:
    make_agent_service(0)

    decode(call({"room_name": "room-1"}, make_token()))

    assert desired_count() == 1


def test_does_not_touch_running_agent(make_token: Callable[..., str], wake_env: None) -> None:
    make_agent_service(2)

    decode(call({"room_name": "room-1"}, make_token()))

    # オートスケールなどで増えた台数は変えない
    assert desired_count() == 2


def test_issues_token_even_if_wake_fails(make_token: Callable[..., str], wake_env: None) -> None:
    # サービスが無い(権限が無い、など)ときも、トークンは出す
    decode(call({"room_name": "room-1"}, make_token()))


def test_no_wake_without_settings() -> None:
    # ローカルと prod では ECS を呼ばない
    assert agent_wake.wake() is False
