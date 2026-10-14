"""画像・動画のマルチパートのアップロード(media.py の uploads、parts、complete)。

パートは署名付き URL の代わりに boto3 で置く(moto は署名付き URL への HTTP を受けない)。
"""

from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import boto3
import pytest
from timeline_env import (
    MEDIA_BUCKET,
    FakeLiveKit,
    Token,
    call,
    setup_timeline,
    teardown_timeline,
)

from voice_intercom_api import media_store, timeline_store
from voice_intercom_api.media import part_size_for

MIB = 1024 * 1024
# 8MB、8MB、10 バイトの3パート
SIZE = 16 * MIB + 10


@pytest.fixture(autouse=True)
def timeline(tables: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    setup_timeline(monkeypatch)
    FakeLiveKit().install(monkeypatch)
    yield
    teardown_timeline()


@pytest.fixture
def member(make_token: Token) -> str:
    return make_token(sub="member-1", **{"cognito:groups": []})


@pytest.fixture
def other_member(make_token: Token) -> str:
    return make_token(sub="member-2", **{"cognito:groups": []})


def create_upload(token: str, **overrides: Any) -> dict[str, Any]:
    body = {"content_type": "video/mp4", "size_bytes": SIZE, "has_thumbnail": False} | overrides
    status, res = call("POST", "/rooms/room-a/media/uploads", token, body)
    assert status == 200
    return res


def complete(token: str, media_id: str, body: Any = None) -> tuple[int, Any]:
    return call("POST", f"/rooms/room-a/media/{media_id}/complete", token, body or {})


def part_urls(token: str, media_id: str, numbers: list[int], **extra: Any) -> tuple[int, Any]:
    return call(
        "POST", f"/rooms/room-a/media/{media_id}/parts", token, {"part_numbers": numbers} | extra
    )


def key(media_id: str) -> str:
    return f"rooms/room-a/{media_id}/original"


def data(size: int = SIZE) -> bytes:
    return bytes(i % 251 for i in range(size))


def upload_id(media_id: str) -> str:
    pending = timeline_store.get_pending_upload("room-a", media_id)
    assert pending is not None and pending.upload_id is not None
    return pending.upload_id


def upload_parts(media_id: str, body: bytes, part_size: int = 8 * MIB) -> list[dict[str, Any]]:
    """パートを置き、complete に渡す parts を返す。"""
    s3 = boto3.client("s3")
    parts: list[dict[str, Any]] = []
    for i in range(0, len(body), part_size):
        number = i // part_size + 1
        res = s3.upload_part(
            Bucket=MEDIA_BUCKET,
            Key=key(media_id),
            UploadId=upload_id(media_id),
            PartNumber=number,
            Body=body[i : i + part_size],
        )
        parts.append({"part_number": number, "etag": res["ETag"]})
    return parts


def in_progress() -> list[str]:
    res = boto3.client("s3").list_multipart_uploads(Bucket=MEDIA_BUCKET)
    return [u["Key"] for u in res.get("Uploads", [])]


def put_thumbnail(media_id: str) -> None:
    boto3.client("s3").put_object(
        Bucket=MEDIA_BUCKET,
        Key=f"rooms/room-a/{media_id}/thumbnail",
        Body=b"jpg",
        ContentType="image/jpeg",
    )


@pytest.mark.parametrize(
    ("size", "expected"),
    [
        (1, None),
        (16 * MIB - 1, None),
        (16 * MIB, 8 * MIB),
        (10 * 1024**3, 8 * MIB),
        # パートが 10,000 を超えないよう、1MB 単位で大きくする(上限の 10GB では起きない)
        (80 * 1024**3 + 1, 9 * MIB),
    ],
)
def test_part_size(size: int, expected: int | None) -> None:
    part_size = part_size_for(size)

    assert part_size == expected
    if part_size is not None:
        assert -(-size // part_size) <= 10_000


def test_large_upload_is_multipart(member: str) -> None:
    body = create_upload(member, size_bytes=10 * 1024**3, has_thumbnail=True)

    assert body["upload_url"] is None
    assert body["multipart"] == {"part_size": 8 * MIB, "part_count": 1280}
    # サムネイルは1回の PUT のまま
    assert urlparse(body["thumbnail_upload_url"]).path.endswith(
        f"rooms/room-a/{body['media_id']}/thumbnail"
    )
    assert in_progress() == [key(body["media_id"])]
    # UploadId はクライアントに返さず、仮の行に持つ
    assert "upload_id" not in body
    pending = timeline_store.get_pending_upload("room-a", body["media_id"])
    assert pending is not None and pending.part_count == 1280


def test_small_upload_is_single_put(member: str) -> None:
    body = create_upload(member, content_type="image/png", size_bytes=16 * MIB - 1)

    assert body["upload_url"] is not None
    assert body["multipart"] is None
    assert in_progress() == []


def test_part_urls(member: str) -> None:
    media_id = create_upload(member, has_thumbnail=True)["media_id"]

    status, body = part_urls(member, media_id, [3, 1])

    assert status == 200
    assert body["expires_at"].endswith("Z")
    assert body["thumbnail_upload_url"] is None
    assert [p["part_number"] for p in body["parts"]] == [3, 1]
    parsed = urlparse(body["parts"][0]["url"])
    query = parse_qs(parsed.query)
    assert parsed.path.endswith(key(media_id))
    assert query["partNumber"] == ["3"]
    assert query["uploadId"] == [upload_id(media_id)]
    assert query["X-Amz-Expires"] == ["3600"]

    # サムネイルの URL も取り直せる
    status, body = part_urls(member, media_id, [], thumbnail=True)
    assert status == 200
    assert body["parts"] == []
    assert urlparse(body["thumbnail_upload_url"]).path.endswith(
        f"rooms/room-a/{media_id}/thumbnail"
    )


def test_part_urls_validates(member: str, other_member: str) -> None:
    media_id = create_upload(member)["media_id"]

    assert part_urls(member, media_id, [4])[0] == 422
    assert part_urls(member, media_id, [0])[0] == 422
    assert part_urls(member, media_id, [1, 1])[0] == 422
    assert part_urls(member, media_id, list(range(1, 102)))[0] == 422
    # 本人だけ
    assert part_urls(other_member, media_id, [1])[0] == 403
    assert part_urls(member, "0" * 32, [1])[0] == 404
    # 1回の PUT のアップロードには無い
    single = create_upload(member, content_type="image/png", size_bytes=3)
    assert part_urls(member, single["media_id"], [1])[0] == 409


def test_complete(member: str, other_member: str) -> None:
    media_id = create_upload(member, has_thumbnail=True)["media_id"]
    body = data()
    parts = upload_parts(media_id, body)
    put_thumbnail(media_id)

    # 順は問わない
    status, event = complete(member, media_id, {"parts": list(reversed(parts))})

    assert status == 200
    assert event["media"]["size_bytes"] == SIZE
    assert event["media"]["content_type"] == "video/mp4"
    obj = boto3.client("s3").get_object(Bucket=MEDIA_BUCKET, Key=key(media_id))
    # Content-Type は uploads で始めたときのもの
    assert obj["ContentType"] == "video/mp4"
    assert obj["Body"].read() == body
    assert in_progress() == []
    _, page = call("GET", "/rooms/room-a/timeline", other_member)
    assert page["items"] == [event]

    # 2回目は同じ履歴(parts が無くても)。パートの URL はもう出さない
    assert complete(member, media_id) == (200, event)
    assert complete(member, media_id, {"parts": parts}) == (200, event)
    assert part_urls(member, media_id, [1])[0] == 409


def test_complete_after_lost_response(member: str) -> None:
    # 前の complete が完了させた後に落ちた(履歴は書いていない)。S3 にアップロードはもう無い
    media_id = create_upload(member)["media_id"]
    parts = upload_parts(media_id, data())
    media_store.complete_multipart(
        key(media_id), upload_id(media_id), [(p["part_number"], p["etag"]) for p in parts]
    )

    status, event = complete(member, media_id, {"parts": parts})

    assert status == 200
    assert event["media"]["size_bytes"] == SIZE


@pytest.mark.parametrize(
    "numbers",
    [
        pytest.param(None, id="no-parts"),
        pytest.param([1, 2], id="missing"),
        pytest.param([1, 2, 3, 4], id="extra"),
        pytest.param([1, 2, 2, 3], id="duplicate"),
    ],
)
def test_complete_requires_all_parts(member: str, numbers: list[int] | None) -> None:
    media_id = create_upload(member)["media_id"]
    uploaded = upload_parts(media_id, data())
    body = (
        None
        if numbers is None
        else {
            "parts": [{"part_number": n, "etag": uploaded[min(n, 3) - 1]["etag"]} for n in numbers]
        }
    )

    assert complete(member, media_id, body)[0] == 422
    # アップロードは残り、正しい parts でやり直せる
    assert complete(member, media_id, {"parts": uploaded})[0] == 200


def test_complete_with_wrong_etag(member: str) -> None:
    media_id = create_upload(member)["media_id"]
    parts = upload_parts(media_id, data())
    parts[1]["etag"] = '"0123456789abcdef0123456789abcdef"'

    # 完了できない。アップロードを取りやめ、uploads からやり直させる
    assert complete(member, media_id, {"parts": parts})[0] == 410
    assert in_progress() == []
    assert timeline_store.list_events("room-a", limit=10, before=None) == ([], None)


def test_complete_aborted(member: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # 期限(ライフサイクルルール)で消えた
    media_id = create_upload(member)["media_id"]
    parts = upload_parts(media_id, data())
    media_store.abort_multipart(key(media_id), upload_id(media_id))
    # S3(と SeaweedFS)は NoSuchUpload を返すが、moto は取りやめた後の完了で落ちるので代える
    real = media_store.complete_multipart

    def gone(k: str, u: str, p: list[tuple[int, str]]) -> None:
        if u == upload_id(media_id):
            raise media_store.MultipartGoneError(u)
        real(k, u, p)

    monkeypatch.setattr(media_store, "complete_multipart", gone)

    assert complete(member, media_id, {"parts": parts})[0] == 410


def test_complete_with_wrong_size(member: str) -> None:
    # 申告より大きく置いた。完了した後なので本体を消して 410
    media_id = create_upload(member)["media_id"]
    parts = upload_parts(media_id, data(SIZE + 5))

    assert complete(member, media_id, {"parts": parts})[0] == 410
    assert media_store.head(key(media_id)) is None


def test_complete_checks_thumbnail_first(member: str) -> None:
    media_id = create_upload(member, has_thumbnail=True)["media_id"]
    parts = upload_parts(media_id, data())

    assert complete(member, media_id, {"parts": parts})[0] == 409
    # 完了させていないので、サムネイルを置けば同じパートで続けられる
    assert in_progress() == [key(media_id)]

    put_thumbnail(media_id)

    assert complete(member, media_id, {"parts": parts})[0] == 200


def test_complete_after_delete(member: str) -> None:
    media_id = create_upload(member)["media_id"]
    parts = upload_parts(media_id, data())
    _, event = complete(member, media_id, {"parts": parts})
    status, _ = call(
        "DELETE", "/rooms/room-a/timeline/event", member, query={"event_id": event["event_id"]}
    )
    assert status == 200
    assert media_store.head(key(media_id)) is None

    # 消した後の complete は墓石を返す。本体が置き直されていても消し直す
    boto3.client("s3").put_object(Bucket=MEDIA_BUCKET, Key=key(media_id), Body=b"x")
    status, again = complete(member, media_id, {"parts": parts})

    assert status == 200
    assert again["deleted"] is not None
    assert media_store.head(key(media_id)) is None


def test_delete_aborts_multipart(member: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # 同時に呼ばれた complete が後から完了させないよう、消すときにアップロードも取りやめる
    media_id = create_upload(member)["media_id"]
    parts = upload_parts(media_id, data())
    _, event = complete(member, media_id, {"parts": parts})
    aborted: list[tuple[str, str]] = []
    monkeypatch.setattr(media_store, "abort_multipart", lambda k, u: aborted.append((k, u)))  # pyright: ignore[reportUnknownLambdaType]

    call("DELETE", "/rooms/room-a/timeline/event", member, query={"event_id": event["event_id"]})

    assert aborted == [(key(media_id), upload_id(media_id))]
