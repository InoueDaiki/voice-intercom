"""メンバーを外したとき・アーカイブしたとき・ルームを消したときの後始末(room_cleanup.py)。"""

import asyncio
from collections.abc import Iterator
from typing import Any

import boto3
import pytest
from livekit import api as livekit
from timeline_env import (
    MEDIA_BUCKET,
    TIMELINE_TABLE,
    FakeLiveKit,
    Token,
    call,
    setup_timeline,
    teardown_timeline,
)

from voice_intercom_api import media_store, room_cleanup, store, timeline_store

STANDARD = livekit.ParticipantInfo.Kind.STANDARD
AGENT = livekit.ParticipantInfo.Kind.AGENT


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
def invalidations(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    calls: list[list[str]] = []

    def invalidate(paths: list[str], *, caller_reference: str) -> bool:
        calls.append(paths)
        return True

    monkeypatch.setattr(media_store, "invalidate", invalidate)
    return calls


@pytest.fixture
def admin(make_token: Token) -> str:
    # ルームを作ったテナント(t1)の管理者
    store.put_user("admin-1", display_name="管理者", language="ja")
    store.set_user_tenant("admin-1", "t1")
    return make_token(sub="admin-1")


def not_found() -> livekit.ServerError:
    return livekit.ServerError("not_found", "participant not found", status=404)


def put_rows(room_id: str, count: int = 2) -> None:
    table = boto3.resource("dynamodb").Table(TIMELINE_TABLE)  # pyright: ignore[reportAttributeAccessIssue]
    for partition in timeline_store.room_partitions(room_id):
        for i in range(count):
            table.put_item(Item={"room_id": partition, "event_id": f"e{i}"})


def rows(room_id: str) -> list[dict[str, Any]]:
    table = boto3.resource("dynamodb").Table(TIMELINE_TABLE)  # pyright: ignore[reportAttributeAccessIssue]
    items: list[dict[str, Any]] = []
    for partition in timeline_store.room_partitions(room_id):
        items += table.query(
            KeyConditionExpression="room_id = :r", ExpressionAttributeValues={":r": partition}
        )["Items"]
    return items


def put_objects(room_id: str) -> str:
    """本体・サムネイルと、途中のマルチパートを置き、UploadId を返す。"""
    s3 = boto3.client("s3")
    for key in ["m1/original", "m1/thumbnail", "m2/original"]:
        s3.put_object(Bucket=MEDIA_BUCKET, Key=f"rooms/{room_id}/{key}", Body=b"x")
    res = s3.create_multipart_upload(Bucket=MEDIA_BUCKET, Key=f"rooms/{room_id}/m3/original")
    return res["UploadId"]


def keys(room_id: str) -> list[str]:
    res = boto3.client("s3").list_objects_v2(Bucket=MEDIA_BUCKET, Prefix=f"rooms/{room_id}/")
    return [obj["Key"] for obj in res.get("Contents", [])]


def uploads(room_id: str) -> list[str]:
    res = boto3.client("s3").list_multipart_uploads(Bucket=MEDIA_BUCKET, Prefix=f"rooms/{room_id}/")
    return [u["UploadId"] for u in res.get("Uploads", [])]


# メンバーを外す


def test_removing_member_evicts_them(admin: str, lk: FakeLiveKit) -> None:
    lk.participants = [("member-1", STANDARD), ("member-2", STANDARD), ("agent-1", AGENT)]

    status, _ = call("DELETE", "/rooms/room-a/members/member-1", admin)

    assert status == 204
    assert store.get_room("room-a").member_ids == ["member-2"]  # pyright: ignore[reportOptionalMemberAccess]
    # 外した人だけを出す。残った人と Agent はそのまま
    assert lk.removed == [("room-a", "member-1")]


def test_removing_absent_member_does_not_remove(admin: str, lk: FakeLiveKit) -> None:
    lk.participants = [("member-2", STANDARD)]

    call("DELETE", "/rooms/room-a/members/member-1", admin)

    # 今ルームにいない人は呼ばない
    assert lk.removed == []


def test_rename_does_not_call_livekit(admin: str, lk: FakeLiveKit) -> None:
    call("PATCH", "/rooms/room-a", admin, {"name": "A2"})

    assert lk.listed == []


def test_archive_closes_room(admin: str, lk: FakeLiveKit) -> None:
    status, body = call("POST", "/rooms/room-a/archive", admin)

    assert status == 200
    assert body["archived_at"] is not None
    # 全員を切る。履歴は消さない
    assert lk.deleted_rooms == ["room-a"]


def test_evict_ignores_errors(lk: FakeLiveKit) -> None:
    lk.participants = [("member-1", STANDARD), ("member-2", STANDARD), ("member-3", STANDARD)]
    lk.remove_errors = {
        # 呼ぶ前に出ていった
        "member-1": not_found(),
        "member-2": livekit.ServerError("unavailable", "no response", status=503),
    }

    removed = room_cleanup.evict("room-a", ["member-1", "member-2", "member-3"])

    # 出せなかった人(member-2)はログに残し、ほかの人は出す
    assert removed == ["member-1", "member-3"]
    assert lk.removed == [("room-a", "member-3")]


def test_remove_list_error_is_not_500(admin: str, lk: FakeLiveKit) -> None:
    lk.list_error = livekit.ServerError("unauthenticated", "permissions denied", status=401)

    status, _ = call("DELETE", "/rooms/room-a/members/member-1", admin)

    assert status == 204
    assert lk.removed == []


def test_evict_room_not_found(lk: FakeLiveKit) -> None:
    lk.list_error = not_found()

    assert room_cleanup.evict("room-a", ["member-1"]) == []


# ルームを消す


def test_delete_closes_room_and_purges(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]]
) -> None:
    put_rows("room-a")
    put_rows("room-b")
    upload_id = put_objects("room-a")
    put_objects("room-b")

    status, _ = call("DELETE", "/rooms/room-a", admin)

    assert status == 204
    # LiveKit のルームごと消して、全員(Agent も)を切る
    assert lk.deleted_rooms == ["room-a"]
    assert rows("room-a") == []
    assert keys("room-a") == []
    assert upload_id not in uploads("room-a")
    assert invalidations == [["/rooms/room-a/*"]]
    # ほかのルームは消さない
    assert len(rows("room-b")) == 6
    assert len(keys("room-b")) == 3
    assert len(uploads("room-b")) == 1


def test_delete_pages_through_rows(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(timeline_store, "_PURGE_PAGE_SIZE", 2)
    put_rows("room-a", count=5)

    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    assert rows("room-a") == []


def test_delete_livekit_error_can_be_retried(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]]
) -> None:
    lk.delete_error = livekit.ServerError("unavailable", "no response", status=503)
    put_rows("room-a")

    assert call("DELETE", "/rooms/room-a", admin)[0] == 503
    # LiveKit に届かなくても、履歴は消す
    assert rows("room-a") == []
    assert store.get_room("room-a") is not None

    lk.delete_error = None
    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    assert store.get_room("room-a") is None


def test_delete_purge_error_can_be_retried(
    admin: str, lk: FakeLiveKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(_room_id: str, *, deadline: float) -> bool:
        raise RuntimeError("DynamoDB に届かない")

    with monkeypatch.context() as m:
        m.setattr(timeline_store, "purge_room", fail)
        assert call("DELETE", "/rooms/room-a", admin)[0] == 503
    room = store.get_room("room-a")
    assert room is not None and room.deleting_at is not None

    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    assert store.get_room("room-a") is None
    assert store.members_of("room-a") == []


def test_purge_over_budget_is_finished_on_delete_again(
    admin: str, lk: FakeLiveKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    put_rows("room-a")
    put_objects("room-a")
    # 時間切れ(残り時間が無い)で、何も消さずにやめる
    monkeypatch.setattr(room_cleanup, "PURGE_BUDGET_S", -1.0)

    # 消しきれなかったことが呼び出し側に分かる
    assert call("DELETE", "/rooms/room-a", admin)[0] == 503
    assert len(rows("room-a")) == 6

    # DELETE をやり直すと、残りを消す
    monkeypatch.setattr(room_cleanup, "PURGE_BUDGET_S", 6.0)
    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    assert rows("room-a") == []
    assert keys("room-a") == []
    assert keys("room-a") == []
    assert uploads("room-a") == []


def test_delete_unknown_room_does_no_cleanup(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]]
) -> None:
    # 行の無いルームには、誰でも CloudFront の無効化や LiveKit の呼び出しを走らせられない
    assert call("DELETE", "/rooms/room-x", admin)[0] == 404
    assert lk.deleted_rooms == []
    assert invalidations == []


def test_delete_removes_staged_uploads(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]]
) -> None:
    key = media_store.staging_media_key("room-a", "m1")
    s3 = boto3.client("s3")
    s3.put_object(Bucket=MEDIA_BUCKET, Key=key, Body=b"x")

    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    assert "Contents" not in s3.list_objects_v2(Bucket=MEDIA_BUCKET, Prefix=key)


# 所属を変えたとき


def test_evict_from_rooms(lk: FakeLiveKit) -> None:
    lk.participants = [("member-1", STANDARD), ("member-2", STANDARD)]

    assert room_cleanup.evict_from_rooms(["room-a", "room-b"], "member-1") == []
    assert sorted(lk.removed) == [("room-a", "member-1"), ("room-b", "member-1")]


def test_evict_from_rooms_reports_failure(lk: FakeLiveKit) -> None:
    lk.participants = [("member-1", STANDARD)]
    lk.remove_errors["member-1"] = RuntimeError("LiveKit に届かない")

    assert room_cleanup.evict_from_rooms(["room-a"], "member-1") == ["room-a"]


def test_evict_from_rooms_stops_at_budget(lk: FakeLiveKit, monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow(_req: Any) -> None:
        await asyncio.sleep(1)

    monkeypatch.setattr(lk, "list_participants", slow)
    monkeypatch.setattr(room_cleanup, "EVICT_BUDGET_S", 0.01)

    assert room_cleanup.evict_from_rooms(["room-a"], "member-1") == ["room-a"]


def test_changing_tenant_evicts_from_livekit(
    admin: str, lk: FakeLiveKit, make_token: Token
) -> None:
    store.create_tenant("t2", "テナント2")
    lk.participants = [("member-1", STANDARD)]
    operator = make_token(sub="op", **{"cognito:groups": ["operator"]})

    assert call("PUT", "/users/member-1/tenant", operator, {"tenant_id": "t2"})[0] == 404
    store.put_user("member-1", display_name="太郎", language="ja")
    assert call("PUT", "/users/member-1/tenant", operator, {"tenant_id": "t2"})[0] == 200

    assert lk.removed == [("room-a", "member-1")]
    assert "member-1" not in store.get_room("room-a").member_ids  # pyright: ignore[reportOptionalMemberAccess]
