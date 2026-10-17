"""complete の後の、ルームへの配信と push 通知(media_broadcast.py)。"""

import threading
import time
from collections.abc import Iterable, Iterator, Mapping
from typing import Any

import boto3
import pytest
from livekit import api as livekit
from timeline_env import (
    MEDIA_BUCKET,
    FakeLiveKit,
    Token,
    call,
    setup_timeline,
    teardown_timeline,
)

from voice_intercom_api import config, media_broadcast, notify, store
from voice_intercom_api.notify import SendResult
from voiceintercom.v1.media_pb2 import MediaMessage

STANDARD = livekit.ParticipantInfo.Kind.STANDARD
AGENT = livekit.ParticipantInfo.Kind.AGENT


class FakeNotify:
    """notify.send_to_users の代わり。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.error: Exception | None = None

    def send_to_users(
        self,
        user_ids: Iterable[str],
        *,
        title: str,
        body: str,
        data: Mapping[str, str] | None = None,
        progress: notify.SendProgress | None = None,
    ) -> SendResult:
        if self.error is not None:
            raise self.error
        ids = list(user_ids)
        self.calls.append({"user_ids": ids, "title": title, "body": body, "data": data})
        return SendResult(sent=len(ids))


@pytest.fixture(autouse=True)
def timeline(tables: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    setup_timeline(monkeypatch)
    store.create_room("room-m", "現場M", ["member-1", "member-2", "member-3", "member-4"])
    store.put_user("member-1", display_name="太郎", language="ja")
    yield
    teardown_timeline()


@pytest.fixture
def lk(monkeypatch: pytest.MonkeyPatch) -> FakeLiveKit:
    fake = FakeLiveKit()
    fake.install(monkeypatch)
    return fake


@pytest.fixture
def push(monkeypatch: pytest.MonkeyPatch) -> FakeNotify:
    fake = FakeNotify()
    monkeypatch.setattr(notify, "send_to_users", fake.send_to_users)
    # サービスアカウントは設定済みとみなす
    monkeypatch.setattr(notify, "service_account", lambda: None)
    return fake


@pytest.fixture
def member(make_token: Token) -> str:
    return make_token(sub="member-1", **{"cognito:groups": []})


def upload(
    token: str,
    *,
    content_type: str = "image/png",
    room_id: str = "room-m",
    has_thumbnail: bool = False,
    complete_body: Any = None,
    file_name: str | None = None,
    **dimensions: int,
) -> tuple[int, Any]:
    _, created = call(
        "POST",
        f"/rooms/{room_id}/media/uploads",
        token,
        {
            "content_type": content_type,
            "size_bytes": 3,
            "has_thumbnail": has_thumbnail,
            "file_name": file_name,
        }
        | dimensions,
    )
    media_id = created["media_id"]
    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=MEDIA_BUCKET,
        Key=f"rooms/{room_id}/{media_id}/upload-original",
        Body=b"abc",
        ContentType=content_type,
    )
    if has_thumbnail:
        s3.put_object(
            Bucket=MEDIA_BUCKET,
            Key=f"rooms/{room_id}/{media_id}/upload-thumbnail",
            Body=b"t",
            ContentType="image/jpeg",
        )
    return complete(token, media_id, room_id, complete_body)


def complete(
    token: str, media_id: str, room_id: str = "room-m", body: Any = None
) -> tuple[int, Any]:
    return call("POST", f"/rooms/{room_id}/media/{media_id}/complete", token, body or {})


def decode(req: livekit.SendDataRequest) -> MediaMessage:
    return MediaMessage.FromString(req.data)


# 配信


def test_sends_media_message_to_room(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    lk.participants = [("member-1", STANDARD), ("member-2", STANDARD), ("agent-1", AGENT)]

    status, event = upload(member, has_thumbnail=True, width=1080, height=1920)

    assert status == 200
    assert lk.listed == ["room-m"]
    assert len(lk.sent) == 1
    req = lk.sent[0]
    assert req.room == "room-m"
    assert req.topic == "media"
    assert req.kind == livekit.DataPacket.Kind.RELIABLE
    # 宛先を指定しない(ルームの全員。送信者本人にも届く)
    assert list(req.destination_identities) == []
    media = event["media"]
    assert decode(req) == MediaMessage(
        event_id=event["event_id"],
        sender_identity="member-1",
        occurred_at=event["occurred_at"],
        media_id=media["media_id"],
        content_type="image/png",
        url=media["url"],
        thumbnail_url=media["thumbnail_url"],
        size_bytes=3,
        width=1080,
        height=1920,
    )
    # 文を添えられないので、text・text_truncated・language は入れない(プロフィールに言語があっても)
    assert decode(req).text == ""
    assert decode(req).language == ""


def test_message_without_thumbnail_and_profile(
    make_token: Token, lk: FakeLiveKit, push: FakeNotify
) -> None:
    # プロフィールの無い人(言語が分からない)
    token = make_token(sub="member-2", **{"cognito:groups": []})
    lk.participants = [("member-3", STANDARD)]

    upload(token, content_type="video/mp4")

    message = decode(lk.sent[0])
    assert message.thumbnail_url == ""
    assert message.language == ""
    assert message.text == ""
    # 幅・高さ・長さを送らなかったら 0
    assert (message.width, message.height, message.duration_ms) == (0, 0, 0)


def test_message_has_video_duration(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    lk.participants = [("member-2", STANDARD)]

    upload(member, content_type="video/mp4", width=720, height=1280, duration_ms=15_500)

    message = decode(lk.sent[0])
    assert (message.width, message.height, message.duration_ms) == (720, 1280, 15_500)


def test_text_from_old_client_is_ignored(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    # 前のクライアントが complete に text を送っても、履歴・配信・push 通知のどれにも出さない
    lk.participants = [("member-2", STANDARD)]

    status, event = upload(member, complete_body={"text": "現場の写真"})

    assert status == 200
    assert event["text"] == ""
    assert event["language"] is None
    message = decode(lk.sent[0])
    assert (message.text, message.text_truncated, message.language) == ("", False, "")
    assert push.calls[0]["body"] == "太郎さんが画像を送りました"


def test_nobody_in_room_skips_send(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    status, _ = upload(member)

    assert status == 200
    assert lk.listed == ["room-m"]
    assert lk.sent == []


def test_only_agent_in_room_skips_send(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    lk.participants = [("agent-1", AGENT)]

    upload(member)

    assert lk.sent == []


def test_room_not_found_is_empty(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    lk.list_error = livekit.ServerError("not_found", "room not found", status=404)

    status, _ = upload(member)

    assert status == 200
    assert lk.sent == []
    # 誰もいないものとして、送信者以外の全員に通知する
    assert push.calls[0]["user_ids"] == ["member-2", "member-3", "member-4"]


def test_list_error_is_not_500(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    lk.list_error = livekit.ServerError("unauthenticated", "permissions denied", status=401)

    status, event = upload(member)

    assert status == 200
    assert event["kind"] == "media"
    # 今いる人が分からないので配信せず、送信者以外の全員に通知する
    assert lk.sent == []
    assert push.calls[0]["user_ids"] == ["member-2", "member-3", "member-4"]


def test_send_error_is_not_500(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    lk.participants = [("member-2", STANDARD)]
    lk.send_error = livekit.ServerError("unavailable", "no response from servers", status=503)

    status, _ = upload(member)

    assert status == 200
    # 今いる人は分かっているので、その人を除いて通知する
    assert push.calls[0]["user_ids"] == ["member-3", "member-4"]


def test_unreachable_livekit_is_not_500(
    member: str, push: FakeNotify, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 本物の SDK で、つながらない LiveKit を呼ぶ
    monkeypatch.setenv("LIVEKIT_CLIENT_URL", "ws://127.0.0.1:1")
    config.get_settings.cache_clear()

    started = time.monotonic()
    status, _ = upload(member)

    assert status == 200
    assert time.monotonic() - started < media_broadcast.LIVEKIT_TIMEOUT_S + 2
    assert push.calls[0]["user_ids"] == ["member-2", "member-3", "member-4"]


def test_second_complete_sends_again_without_push(
    member: str, lk: FakeLiveKit, push: FakeNotify
) -> None:
    lk.participants = [("member-2", STANDARD)]
    _, first = upload(member)

    status, second = complete(member, first["media"]["media_id"])

    assert status == 200
    assert second == first
    # 配信は2回(受け手は event_id で重複を捨てる)、push 通知は1回
    assert [decode(r).event_id for r in lk.sent] == [first["event_id"]] * 2
    assert len(push.calls) == 1


def test_rejected_complete_does_not_send(
    member: str, make_token: Token, lk: FakeLiveKit, push: FakeNotify
) -> None:
    lk.participants = [("member-2", STANDARD)]
    _, first = upload(member)
    lk.sent.clear()
    push.calls.clear()

    # 本人以外は 403 で、配信もしない
    other = make_token(sub="member-2", **{"cognito:groups": []})
    status, _ = complete(other, first["media"]["media_id"])

    assert status == 403
    assert lk.sent == []
    assert push.calls == []


# push 通知


def test_push_to_members_not_in_room(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    lk.participants = [("member-1", STANDARD), ("member-2", STANDARD), ("agent-1", AGENT)]

    _, event = upload(member)

    assert push.calls == [
        {
            "user_ids": ["member-3", "member-4"],
            "title": "現場M",
            "body": "太郎さんが画像を送りました",
            "data": {"type": "media", "room_id": "room-m", "event_id": event["event_id"]},
        }
    ]


def test_push_body_for_video_and_unknown_sender(
    make_token: Token, lk: FakeLiveKit, push: FakeNotify
) -> None:
    token = make_token(sub="member-2", **{"cognito:groups": []})

    upload(token, content_type="video/mp4")

    assert push.calls[0]["body"] == "誰かが動画を送りました"
    assert push.calls[0]["user_ids"] == ["member-1", "member-3", "member-4"]


def test_file_message_and_push(make_token: Token, lk: FakeLiveKit, push: FakeNotify) -> None:
    store.put_user("member-1", display_name="太郎", language="ja")
    token = make_token(sub="member-1", **{"cognito:groups": []})
    lk.participants = [("member-2", STANDARD)]

    upload(token, content_type="application/pdf", file_name="図面.pdf")

    message = decode(lk.sent[0])
    assert message.content_type == "application/pdf"
    assert message.file_name == "図面.pdf"
    assert push.calls[0]["body"] == "太郎さんがファイルを送りました"


def test_admin_upload_pushes_to_all_members(
    make_token: Token, lk: FakeLiveKit, push: FakeNotify
) -> None:
    # メンバーではない管理者(管理コンソール)が上げても、同じに届く
    admin = make_token(sub="admin-1")
    lk.participants = [("member-2", STANDARD)]

    status, _ = upload(admin)

    assert status == 200
    assert len(lk.sent) == 1
    assert push.calls[0]["user_ids"] == ["member-1", "member-3", "member-4"]


def test_everyone_present_sends_no_push(
    make_token: Token, lk: FakeLiveKit, push: FakeNotify
) -> None:
    token = make_token(sub="member-2", **{"cognito:groups": []})
    lk.participants = [("member-1", STANDARD), ("member-3", STANDARD), ("member-4", STANDARD)]

    upload(token)

    assert push.calls == []


def test_push_is_throttled_per_recipient_and_room(
    make_token: Token, member: str, lk: FakeLiveKit, push: FakeNotify
) -> None:
    store.create_room("room-x", "現場X", ["member-1", "member-3"])

    upload(member)
    # 続けて送っても、間隔の内側の人には送らない
    upload(member)
    # 別の人が送っても、受け手 × ルームで数える(member-1 にはまだ送っていない)
    upload(make_token(sub="member-2", **{"cognito:groups": []}))
    # 別のルームは別に数える
    upload(member, room_id="room-x")

    assert [c["user_ids"] for c in push.calls] == [
        ["member-2", "member-3", "member-4"],
        ["member-1"],
        ["member-3"],
    ]
    assert push.calls[2]["title"] == "現場X"


def test_push_error_releases_interval(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    push.error = RuntimeError("FCM の失敗")
    upload(member)

    # 送れなかったときは時刻を戻すので、次の画像で送れる
    push.error = None
    upload(member)

    assert [c["user_ids"] for c in push.calls] == [["member-2", "member-3", "member-4"]]


def test_push_error_is_not_500(member: str, lk: FakeLiveKit, push: FakeNotify) -> None:
    push.error = RuntimeError("FCM のアクセストークンを作れなかった")

    status, event = upload(member)

    assert status == 200
    assert event["kind"] == "media"


def test_slow_push_returns_in_time(
    member: str, lk: FakeLiveKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    release = threading.Event()

    def slow(user_ids: Iterable[str], **_kwargs: Any) -> SendResult:
        release.wait(5)
        return SendResult()

    monkeypatch.setattr(notify, "send_to_users", slow)
    monkeypatch.setattr(notify, "service_account", lambda: None)
    monkeypatch.setattr(media_broadcast, "PUSH_TIMEOUT_S", 0.1)
    started = time.monotonic()
    try:
        status, _ = upload(member)
    finally:
        release.set()

    assert status == 200
    assert time.monotonic() - started < 2

    # 待ちきれなかった送信は打ち切り、時刻を戻すので、次の画像で送る
    push = FakeNotify()
    monkeypatch.setattr(notify, "send_to_users", push.send_to_users)
    upload(member)
    assert [c["user_ids"] for c in push.calls] == [["member-2", "member-3", "member-4"]]
