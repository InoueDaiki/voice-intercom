"""送った本人による削除(DELETE /rooms/{room_id}/timeline/event)と、1件の取得。"""

from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from livekit import api as livekit
from timeline_env import (
    AGENT_SCOPE,
    MEDIA_BUCKET,
    TIMELINE_TABLE,
    FakeLiveKit,
    Token,
    call,
    setup_timeline,
    teardown_timeline,
)

from voice_intercom_api import config, media_store
from voiceintercom.v1.deletion_pb2 import DeletionMessage

STANDARD = livekit.ParticipantInfo.Kind.STANDARD
AGENT = livekit.ParticipantInfo.Kind.AGENT


class FakeCloudFront:
    def __init__(self) -> None:
        self.invalidations: list[dict[str, Any]] = []

    def create_invalidation(self, **kwargs: Any) -> dict[str, Any]:
        self.invalidations.append(kwargs)
        return {}


@pytest.fixture(autouse=True)
def timeline(tables: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    setup_timeline(monkeypatch)
    yield
    teardown_timeline()


@pytest.fixture
def lk(monkeypatch: pytest.MonkeyPatch) -> FakeLiveKit:
    fake = FakeLiveKit()
    fake.install(monkeypatch)
    return fake


@pytest.fixture
def cloudfront(monkeypatch: pytest.MonkeyPatch, lk: FakeLiveKit) -> FakeCloudFront:
    fake = FakeCloudFront()
    monkeypatch.setenv("MEDIA_DISTRIBUTION_ID", "E123")
    config.get_timeline_settings.cache_clear()
    monkeypatch.setattr(media_store, "_cloudfront", lambda: fake)
    return fake


@pytest.fixture
def admin(make_token: Token) -> str:
    return make_token(sub="admin-1")


@pytest.fixture
def member(make_token: Token) -> str:
    return make_token(sub="member-1", **{"cognito:groups": []})


@pytest.fixture
def other_member(make_token: Token) -> str:
    return make_token(sub="member-2", **{"cognito:groups": []})


@pytest.fixture
def outsider(make_token: Token) -> str:
    return make_token(sub="outsider-1", **{"cognito:groups": None})


@pytest.fixture
def agent(make_token: Token) -> str:
    return make_token(sub="agent-client", scope=AGENT_SCOPE, **{"cognito:groups": None})


def text_body(**overrides: Any) -> dict[str, Any]:
    return {
        "kind": "text",
        "sender_id": "member-1",
        "occurred_at": "2026-10-10T00:00:00.000Z",
        "language": "ja",
        "text": "在庫は残り1,250個です。",
        "translations": {"en": "There are 1,250 units left."},
        "message_id": "m1",
    } | overrides


def put_text(agent: str, source_id: str = "seg-1", **overrides: Any) -> Any:
    status, body = call("PUT", f"/rooms/room-a/timeline/{source_id}", agent, text_body(**overrides))
    assert status == 200
    return body


def delete(token: str, event_id: str, room_id: str = "room-a") -> tuple[int, Any]:
    return call("DELETE", f"/rooms/{room_id}/timeline/event", token, query={"event_id": event_id})


def get(token: str, event_id: str, room_id: str = "room-a") -> tuple[int, Any]:
    return call("GET", f"/rooms/{room_id}/timeline/event", token, query={"event_id": event_id})


def upload_media(
    token: str, *, content_type: str = "image/png", has_thumbnail: bool = True
) -> dict[str, Any]:
    _, created = call(
        "POST",
        "/rooms/room-a/media/uploads",
        token,
        {"content_type": content_type, "size_bytes": 3, "has_thumbnail": has_thumbnail},
    )
    media_id = created["media_id"]
    s3 = boto3.client("s3")
    s3.put_object(
        Bucket=MEDIA_BUCKET, Key=media_store.staging_media_key("room-a", media_id), Body=b"abc"
    )
    if has_thumbnail:
        s3.put_object(
            Bucket=MEDIA_BUCKET,
            Key=media_store.staging_thumbnail_key("room-a", media_id),
            Body=b"t",
        )
    status, event = call("POST", f"/rooms/room-a/media/{media_id}/complete", token, {})
    assert status == 200
    return event


# テキスト入力


def test_agent_puts_message_id(agent: str, member: str) -> None:
    put_text(agent)

    _, page = call("GET", "/rooms/room-a/timeline", member)
    assert page["items"][0]["message_id"] == "m1"
    assert page["items"][0]["deleted"] is None


def test_message_id_only_for_text(agent: str) -> None:
    status, _ = call(
        "PUT",
        "/rooms/room-a/timeline/seg-1",
        agent,
        text_body(kind="utterance", utterance_id="u1", segment_index=0),
    )

    assert status == 422


def test_sender_deletes_text(agent: str, member: str, other_member: str, lk: FakeLiveKit) -> None:
    event = put_text(agent)

    status, body = delete(member, event["event_id"])

    assert status == 200
    assert body["event_id"] == event["event_id"]
    assert body["kind"] == "text"
    assert body["sender_id"] == "member-1"
    assert body["occurred_at"] == event["occurred_at"]
    # 本文と訳は返さない
    assert body["text"] == ""
    assert body["translations"] == {}
    assert body["message_id"] == "m1"
    assert body["deleted"]["media_type"] is None
    assert body["deleted"]["deleted_at"].endswith("Z")
    # 履歴の一覧と1件の取得でも墓石になる(ほかのメンバーから見ても)
    _, page = call("GET", "/rooms/room-a/timeline", other_member)
    assert page["items"] == [body]
    assert get(other_member, event["event_id"]) == (200, body)


def test_tombstone_drops_text_from_storage(agent: str, member: str, lk: FakeLiveKit) -> None:
    event = put_text(agent)
    delete(member, event["event_id"])

    item = boto3.client("dynamodb").get_item(
        TableName=TIMELINE_TABLE,
        Key={"room_id": {"S": "room-a"}, "event_id": {"S": event["event_id"]}},
    )["Item"]
    assert "text" not in item
    assert "translations" not in item
    assert "deleted_at" in item


def test_second_delete_returns_same(agent: str, member: str, lk: FakeLiveKit) -> None:
    event = put_text(agent)

    first = delete(member, event["event_id"])
    second = delete(member, event["event_id"])

    assert first == second


def test_agent_put_does_not_revive(agent: str, member: str, lk: FakeLiveKit) -> None:
    # 消した後に、Agent の再送が届いても戻さない
    event = put_text(agent)
    _, tombstone = delete(member, event["event_id"])

    again = put_text(agent)

    assert again == tombstone
    _, page = call("GET", "/rooms/room-a/timeline", member)
    assert page["items"] == [tombstone]


@pytest.mark.parametrize("who", ["other_member", "admin"])
def test_only_sender_deletes(
    who: str, agent: str, member: str, request: pytest.FixtureRequest
) -> None:
    event = put_text(agent)

    status, _ = delete(request.getfixturevalue(who), event["event_id"])

    assert status == 403
    _, page = call("GET", "/rooms/room-a/timeline", member)
    assert page["items"][0]["text"] == "在庫は残り1,250個です。"


def test_non_member_and_agent_cannot_delete(agent: str, outsider: str) -> None:
    event = put_text(agent)

    assert delete(outsider, event["event_id"])[0] == 403
    assert delete(agent, event["event_id"])[0] == 403


def test_utterance_cannot_be_deleted(agent: str, member: str) -> None:
    status, event = call(
        "PUT",
        "/rooms/room-a/timeline/seg-1",
        agent,
        text_body(kind="utterance", message_id=None, utterance_id="u1", segment_index=0),
    )
    assert status == 200

    status, _ = delete(member, event["event_id"])

    assert status == 403


def test_delete_unknown(member: str, admin: str) -> None:
    assert delete(member, "2026-10-10T00:00:00.000Z#nothing")[0] == 404
    assert delete(admin, "2026-10-10T00:00:00.000Z#x", room_id="no-room")[0] == 404


def test_delete_requires_event_id(member: str) -> None:
    status, _ = call("DELETE", "/rooms/room-a/timeline/event", member)

    assert status == 422


# 1件の取得


def test_get_event(agent: str, member: str, admin: str, outsider: str) -> None:
    event = put_text(agent)

    assert get(member, event["event_id"]) == (200, event)
    # 管理者もメンバーでなければ読めない
    assert get(admin, event["event_id"])[0] == 403
    assert get(outsider, event["event_id"])[0] == 403
    assert get(member, "2026-10-10T00:00:00.000Z#nothing")[0] == 404


# 画像・動画


def test_sender_deletes_media(member: str, cloudfront: FakeCloudFront) -> None:
    event = upload_media(member)
    media_id = event["media"]["media_id"]

    status, body = delete(member, event["event_id"])

    assert status == 200
    assert body["kind"] == "media"
    assert body["media"] is None
    assert body["deleted"]["media_type"] == "image"
    # S3 の本体とサムネイルを消す
    assert media_store.head(media_store.media_key("room-a", media_id)) is None
    assert media_store.head(media_store.thumbnail_key("room-a", media_id)) is None
    # CloudFront のキャッシュを media_id ごとに1つのパスで無効にする
    assert cloudfront.invalidations == [
        {
            "DistributionId": "E123",
            "InvalidationBatch": {
                "Paths": {"Quantity": 1, "Items": [f"/rooms/room-a/{media_id}/*"]},
                "CallerReference": f"delete-{media_id}",
            },
        }
    ]


def test_delete_purges_staged_upload(member: str, cloudfront: FakeCloudFront) -> None:
    # complete の後に仮置きへ置き直したものも消す
    event = upload_media(member)
    media_id = event["media"]["media_id"]
    s3 = boto3.client("s3")
    staged = [
        media_store.staging_media_key("room-a", media_id),
        media_store.staging_thumbnail_key("room-a", media_id),
    ]
    for key in staged:
        s3.put_object(Bucket=MEDIA_BUCKET, Key=key, Body=b"again")

    assert delete(member, event["event_id"])[0] == 200

    assert [media_store.head(key) for key in staged] == [None, None]


def test_deleted_video_says_video(member: str, cloudfront: FakeCloudFront) -> None:
    event = upload_media(member, content_type="video/mp4")

    _, body = delete(member, event["event_id"])

    assert body["deleted"]["media_type"] == "video"


def test_media_without_distribution_skips_invalidation(member: str, lk: FakeLiveKit) -> None:
    # ローカル(CloudFront が無い)では、S3 だけを消す
    event = upload_media(member, has_thumbnail=False)

    status, _ = delete(member, event["event_id"])

    assert status == 200
    assert media_store.head(media_store.media_key("room-a", event["media"]["media_id"])) is None


def test_second_media_delete_retries_cleanup(
    member: str, cloudfront: FakeCloudFront, monkeypatch: pytest.MonkeyPatch
) -> None:
    event = upload_media(member)

    def fail(keys: list[str]) -> None:
        raise RuntimeError("S3 に届かない")

    with monkeypatch.context() as m:
        m.setattr(media_store, "delete", fail)
        # 後始末が失敗しても、墓石を 200 で返す
        status, first = delete(member, event["event_id"])
    assert status == 200
    assert cloudfront.invalidations == []

    status, second = delete(member, event["event_id"])

    assert (status, second) == (200, first)
    assert media_store.head(media_store.media_key("room-a", event["media"]["media_id"])) is None
    assert len(cloudfront.invalidations) == 1


def test_complete_after_delete_returns_tombstone(member: str, cloudfront: FakeCloudFront) -> None:
    event = upload_media(member)
    _, tombstone = delete(member, event["event_id"])
    sent = len(cloudfront.invalidations)

    status, body = call(
        "POST", f"/rooms/room-a/media/{event['media']['media_id']}/complete", member, {}
    )

    assert (status, body) == (200, tombstone)
    assert len(cloudfront.invalidations) == sent


# ルームへの知らせ


def test_announces_deletion_to_room(agent: str, member: str, lk: FakeLiveKit) -> None:
    lk.participants = [("member-1", STANDARD), ("member-2", STANDARD), ("agent", AGENT)]
    event = put_text(agent)

    _, body = delete(member, event["event_id"])

    assert len(lk.sent) == 1
    req = lk.sent[0]
    assert req.room == "room-a"
    assert req.topic == "deletion"
    assert req.kind == livekit.DataPacket.Kind.RELIABLE
    assert DeletionMessage.FromString(req.data) == DeletionMessage(
        event_id=event["event_id"],
        sender_identity="member-1",
        kind="text",
        message_id="m1",
        deleted_at=body["deleted"]["deleted_at"],
    )


def test_second_delete_announces_again(agent: str, member: str, lk: FakeLiveKit) -> None:
    lk.participants = [("member-2", STANDARD)]
    event = put_text(agent)

    delete(member, event["event_id"])
    delete(member, event["event_id"])

    assert len(lk.sent) == 2


def test_nobody_in_room_skips_announce(agent: str, member: str, lk: FakeLiveKit) -> None:
    lk.participants = [("agent", AGENT)]
    event = put_text(agent)

    assert delete(member, event["event_id"])[0] == 200
    assert lk.sent == []


def test_announce_error_is_not_500(agent: str, member: str, lk: FakeLiveKit) -> None:
    lk.list_error = RuntimeError("LiveKit に届かない")
    event = put_text(agent)

    status, body = delete(member, event["event_id"])

    assert status == 200
    assert body["deleted"] is not None
