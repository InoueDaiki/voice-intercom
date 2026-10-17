"""メンバーを外したとき・ルームを消したときの後始末(room_cleanup.py)。"""

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


def test_patch_evicts_removed_members(admin: str, lk: FakeLiveKit) -> None:
    lk.participants = [("member-1", STANDARD), ("member-2", STANDARD), ("agent-1", AGENT)]

    status, body = call("PATCH", "/rooms/room-a", admin, {"member_ids": ["member-2"]})

    assert status == 200
    assert body["member_ids"] == ["member-2"]
    # 外した人だけを出す。残った人と Agent はそのまま
    assert lk.removed == [("room-a", "member-1")]


def test_patch_skips_absent_members(admin: str, lk: FakeLiveKit) -> None:
    lk.participants = [("member-2", STANDARD)]

    call("PATCH", "/rooms/room-a", admin, {"member_ids": ["member-2"]})

    # 今ルームにいない人は呼ばない
    assert lk.removed == []


def test_patch_without_member_change_does_not_call_livekit(admin: str, lk: FakeLiveKit) -> None:
    call("PATCH", "/rooms/room-a", admin, {"name": "A2"})

    assert lk.listed == []


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


def test_patch_list_error_is_not_500(admin: str, lk: FakeLiveKit) -> None:
    lk.list_error = livekit.ServerError("unauthenticated", "permissions denied", status=401)

    status, body = call("PATCH", "/rooms/room-a", admin, {"member_ids": []})

    assert status == 200
    assert body["member_ids"] == []
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


def test_delete_livekit_error_is_not_500(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]]
) -> None:
    lk.delete_error = livekit.ServerError("unavailable", "no response", status=503)
    put_rows("room-a")

    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    # LiveKit に届かなくても、履歴は消す
    assert rows("room-a") == []


def test_delete_purge_error_is_not_500(
    admin: str, lk: FakeLiveKit, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(_room_id: str, *, deadline: float) -> bool:
        raise RuntimeError("DynamoDB に届かない")

    monkeypatch.setattr(timeline_store, "purge_room", fail)

    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    assert store.get_room("room-a") is None


def test_purge_over_budget_is_finished_on_create(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    put_rows("room-a")
    put_objects("room-a")
    # 時間切れ(残り時間が無い)で、何も消さずにやめる
    monkeypatch.setattr(room_cleanup, "PURGE_BUDGET_S", -1.0)

    assert call("DELETE", "/rooms/room-a", admin)[0] == 204
    assert len(rows("room-a")) == 6

    # 同じ room_id で作り直すと、前のルームの残りを消す
    monkeypatch.setattr(room_cleanup, "PURGE_BUDGET_S", 6.0)
    invalidations.clear()
    status, body = call("POST", "/rooms", admin, {"room_id": "room-a", "name": "A2"})

    assert status == 201
    assert body["member_ids"] == []
    assert rows("room-a") == []
    assert keys("room-a") == []
    assert uploads("room-a") == []
    assert invalidations == [["/rooms/room-a/*"]]
    assert call("GET", "/rooms/room-a/timeline", admin) == (200, {"items": [], "next_before": None})


def test_create_without_leftovers_does_not_invalidate(
    admin: str, invalidations: list[list[str]]
) -> None:
    assert call("POST", "/rooms", admin, {"room_id": "room-c", "name": "C"})[0] == 201
    assert invalidations == []


def test_delete_again_finishes_purge(
    admin: str, lk: FakeLiveKit, invalidations: list[list[str]]
) -> None:
    # rooms の行だけ消えて、後始末の前で止まった
    store.delete_room("room-a")
    put_rows("room-a")
    put_objects("room-a")

    # 2回目の DELETE は 404 だが、後始末はやり直す
    assert call("DELETE", "/rooms/room-a", admin)[0] == 404
    assert rows("room-a") == []
    assert keys("room-a") == []
    assert lk.deleted_rooms == ["room-a"]
