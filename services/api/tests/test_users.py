import json
from collections.abc import Callable
from typing import Any, get_args

import boto3
import pytest
from conftest import USERS_TABLE, auth_headers, http_event

from voice_intercom_agent.languages import LANGUAGE_NAMES
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


def test_admin_lists_users(make_token: Token, member: str) -> None:
    admin = make_token(sub="admin-1")
    call("PUT", "/users/me", member, {"display_name": "花子", "language": "ja"})
    call("PUT", "/users/me", admin, {"display_name": "管理者", "language": "en"})

    status, body = call("GET", "/users", admin)

    assert status == 200
    assert [(u["user_id"], u["display_name"]) for u in body["items"]] == [
        ("admin-1", "管理者"),
        ("member-1", "花子"),
    ]


def test_list_users_requires_admin(member: str) -> None:
    assert call("GET", "/users", member)[0] == 403


def test_users_require_token() -> None:
    assert call("GET", "/users/me", None)[0] == 401


def test_languages_match_agent() -> None:
    # Agent が翻訳できる言語と揃っているか
    assert set(get_args(Language)) == set(LANGUAGE_NAMES)
