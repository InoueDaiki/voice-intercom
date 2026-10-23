import json
from collections.abc import Callable
from typing import Any, get_args

import boto3
import pytest
from conftest import USERS_TABLE, auth_headers, http_event

from voice_intercom_agent.languages import LANGUAGE_NAMES
from voice_intercom_api import store
from voice_intercom_api.app import handler
from voice_intercom_api.models import Language

pytestmark = pytest.mark.usefixtures("tables")

Token = Callable[..., str]


@pytest.fixture
def member(make_token: Token) -> str:
    return make_token(sub="member-1", **{"cognito:groups": []})


def call(method: str, path: str, token: str | None, body: Any = None) -> tuple[int, Any]:
    event = http_event(method, path, body=body, headers=auth_headers(token))
    res = handler(event, None)  # pyright: ignore[reportArgumentType]
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None


def test_profile_not_found(member: str) -> None:
    assert call("GET", "/users/me", member)[0] == 404


def test_put_and_get_profile(member: str) -> None:
    status, created = call("PUT", "/users/me", member, {"display_name": "花子", "language": "ko"})

    assert status == 200
    assert created["user_id"] == "member-1"
    assert created["display_name"] == "花子"
    assert created["language"] == "ko"
    assert created["created_at"] == created["updated_at"]
    assert call("GET", "/users/me", member) == (200, created)

    status, updated = call("PUT", "/users/me", member, {"display_name": "花子", "language": "en"})

    assert status == 200
    assert updated["language"] == "en"
    assert updated["created_at"] == created["created_at"]


def test_put_keeps_other_attributes(member: str) -> None:
    # users テーブルには端末トークンなども持たせるので、プロフィールの更新で消さない
    table = boto3.resource("dynamodb").Table(USERS_TABLE)  # pyright: ignore[reportAttributeAccessIssue]
    table.put_item(Item={"user_id": "member-1", "fcm_tokens": ["t1"]})

    call("PUT", "/users/me", member, {"display_name": "花子", "language": "ja"})

    assert table.get_item(Key={"user_id": "member-1"})["Item"]["fcm_tokens"] == ["t1"]


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"display_name": "", "language": "ja"}, id="empty-name"),
        pytest.param({"display_name": "x" * 51, "language": "ja"}, id="long-name"),
        pytest.param({"display_name": "花子", "language": "ja-JP"}, id="region"),
        pytest.param({"display_name": "花子", "language": "th"}, id="unsupported"),
        pytest.param({"display_name": "花子"}, id="no-language"),
    ],
)
def test_put_validates(member: str, body: dict) -> None:
    assert call("PUT", "/users/me", member, body)[0] == 422


def test_lists_users_of_own_tenant(make_token: Token, member: str) -> None:
    other = make_token(sub="member-2", **{"cognito:groups": []})
    outsider = make_token(sub="outsider-1", **{"cognito:groups": []})
    call("PUT", "/users/me", member, {"display_name": "花子", "language": "ja"})
    call("PUT", "/users/me", other, {"display_name": "次郎", "language": "en"})
    call("PUT", "/users/me", outsider, {"display_name": "外部", "language": "en"})
    store.set_user_tenant("member-1", "t1")
    store.set_user_tenant("member-2", "t1")
    store.set_user_tenant("outsider-1", "t2")

    # ルームに招待する相手を選ぶので、管理者でなくても読める。自分のテナントの人だけ
    status, body = call("GET", "/users", member)

    assert status == 200
    assert [(u["user_id"], u["display_name"], u["tenant_id"]) for u in body["items"]] == [
        ("member-1", "花子", "t1"),
        ("member-2", "次郎", "t1"),
    ]


def test_operator_lists_all_users(make_token: Token, member: str) -> None:
    operator = make_token(sub="operator-1", **{"cognito:groups": ["operator"]})
    call("PUT", "/users/me", member, {"display_name": "花子", "language": "ja"})

    # 所属の無い人も出す(運営者が所属を決める)
    status, body = call("GET", "/users", operator)

    assert status == 200
    assert [(u["user_id"], u["tenant_id"]) for u in body["items"]] == [("member-1", None)]


def test_list_users_requires_tenant(member: str) -> None:
    call("PUT", "/users/me", member, {"display_name": "花子", "language": "ja"})

    assert call("GET", "/users", member)[0] == 403


def test_users_require_token() -> None:
    assert call("GET", "/users/me", None)[0] == 401


def test_languages_match_agent() -> None:
    # Agent が翻訳できる言語と揃っているか
    assert set(get_args(Language)) == set(LANGUAGE_NAMES)
