"""履歴とメディアのテストで共通に使うもの(test_timeline.py、test_media.py)。

conftest の tables(moto の中)に、timeline テーブルとメディアのバケットを足す。
"""

import json
from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode

import boto3
import pytest
from conftest import auth_headers, http_event

from voice_intercom_api import config, media_store, store
from voice_intercom_api.app import handler

TIMELINE_TABLE = "voice-intercom-test-timeline"
MEDIA_BUCKET = "voice-intercom-test-media"
MEDIA_BASE_URL = "https://media.test"

AGENT_SCOPE = "voice-intercom/agent"

Token = Callable[..., str]


def setup_timeline(monkeypatch: pytest.MonkeyPatch) -> None:
    """tables の中で呼ぶ。キーは infra/envs/dev/main.tf の timeline テーブルと揃える。"""
    monkeypatch.setenv("TIMELINE_TABLE", TIMELINE_TABLE)
    monkeypatch.setenv("MEDIA_BUCKET", MEDIA_BUCKET)
    monkeypatch.setenv("MEDIA_BASE_URL", MEDIA_BASE_URL + "/")
    monkeypatch.delenv("AWS_ENDPOINT_URL_S3", raising=False)
    config.get_timeline_settings.cache_clear()
    media_store._s3.cache_clear()  # pyright: ignore[reportPrivateUsage]
    boto3.client("dynamodb").create_table(
        TableName=TIMELINE_TABLE,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": "room_id", "AttributeType": "S"},
            {"AttributeName": "event_id", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "room_id", "KeyType": "HASH"},
            {"AttributeName": "event_id", "KeyType": "RANGE"},
        ],
    )
    boto3.client("s3").create_bucket(
        Bucket=MEDIA_BUCKET,
        CreateBucketConfiguration={"LocationConstraint": "ap-northeast-1"},
    )
    store.create_room("room-a", "A", ["member-1", "member-2"])
    store.create_room("room-b", "B", ["member-2"])


def teardown_timeline() -> None:
    config.get_timeline_settings.cache_clear()
    media_store._s3.cache_clear()  # pyright: ignore[reportPrivateUsage]


def call(
    method: str,
    path: str,
    token: str | None,
    body: Any = None,
    query: dict[str, str] | None = None,
) -> tuple[int, Any]:
    event = http_event(method, path, body=body, headers=auth_headers(token))
    if query:
        event["rawQueryString"] = urlencode(query)
        event["queryStringParameters"] = query
    res = handler(event, None)  # pyright: ignore[reportArgumentType]
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None
