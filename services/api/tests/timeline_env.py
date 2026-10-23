"""履歴とメディアのテストで共通に使うもの(test_timeline.py、test_media.py など)。

conftest の tables(moto の中)に、timeline テーブルとメディアのバケットを足す。
"""

import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlencode

import boto3
import pytest
from conftest import auth_headers, http_event
from livekit import api as livekit

from voice_intercom_api import config, media_broadcast, media_store, store
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
    store.create_room("room-a", "A", ["member-1", "member-2"], tenant_id="t1")
    store.create_room("room-b", "B", ["member-2"], tenant_id="t1")


def teardown_timeline() -> None:
    config.get_timeline_settings.cache_clear()
    media_store._s3.cache_clear()  # pyright: ignore[reportPrivateUsage]


class FakeLiveKit:
    """LiveKit の RoomService(ListParticipants、SendData、RemoveParticipant、DeleteRoom)の代わり。

    participants は (identity, kind) の並び。kind は ParticipantInfo.Kind の値。
    """

    def __init__(self) -> None:
        self.participants: list[tuple[str, int]] = []
        self.list_error: Exception | None = None
        self.send_error: Exception | None = None
        self.remove_errors: dict[str, Exception] = {}
        self.delete_error: Exception | None = None
        self.listed: list[str] = []
        self.sent: list[livekit.SendDataRequest] = []
        self.removed: list[tuple[str, str]] = []
        self.deleted_rooms: list[str] = []

    async def list_participants(
        self, req: livekit.ListParticipantsRequest
    ) -> livekit.ListParticipantsResponse:
        self.listed.append(req.room)
        if self.list_error is not None:
            raise self.list_error
        return livekit.ListParticipantsResponse(
            participants=[
                livekit.ParticipantInfo(identity=identity, kind=kind)  # pyright: ignore[reportArgumentType]
                for identity, kind in self.participants
            ]
        )

    async def send_data(self, req: livekit.SendDataRequest) -> livekit.SendDataResponse:
        if self.send_error is not None:
            raise self.send_error
        self.sent.append(req)
        return livekit.SendDataResponse()

    async def remove_participant(
        self, req: livekit.RoomParticipantIdentity
    ) -> livekit.RemoveParticipantResponse:
        if (error := self.remove_errors.get(req.identity)) is not None:
            raise error
        self.removed.append((req.room, req.identity))
        return livekit.RemoveParticipantResponse()

    async def delete_room(self, req: livekit.DeleteRoomRequest) -> livekit.DeleteRoomResponse:
        if self.delete_error is not None:
            raise self.delete_error
        self.deleted_rooms.append(req.room)
        return livekit.DeleteRoomResponse()

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        @asynccontextmanager
        async def room_service() -> AsyncIterator[FakeLiveKit]:
            yield self

        monkeypatch.setattr(media_broadcast, "_room_service", room_service)


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
