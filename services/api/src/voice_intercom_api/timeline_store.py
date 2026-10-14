"""DynamoDB の timeline テーブルの読み書き。

テーブル名は環境変数 TIMELINE_TABLE で受け取る。キーは hash が room_id、range が event_id。

履歴の項目(room_id はルームの ID):
- event_id は `<occurred_at>#<source_id>`。occurred_at は桁をそろえた UTC の時刻なので、
  文字列の順が時刻の順になり、ルームの履歴を1回の Query で新しい順に取れる。
- 項目の形は TimelineEvent とほぼ同じ。ただし media には URL を持たせず、media_id、content_type、
  size_bytes、has_thumbnail(と、あれば width、height、duration_ms)だけを持ち、読むときに URL を作る
  (CloudFront のドメインが変わっても困らない)。
- media の行は text と language を持たない(画像・動画には文を添えられない)。前に添えた文を
  保存した行があっても、読むときに空にする。

アップロード中のメディアの仮の行(complete で本人かを確かめるため):
- room_id を `media-upload#<room_id>`、event_id を media_id にする。
  ルームの ID に # は使えないので、履歴のパーティションと混ざらず、履歴の Query にも出てこない。
- アップロードした人(uploader_id)、Content-Type、大きさ、サムネイルの有無、幅・高さ・動画の長さ
  (送られたときだけ)を持つ。complete で
  クライアントに送り直させず、ここから読む。
- complete したら completed_event_id を書く。2回目の complete は同じ履歴を返す(再送に備える)。
- expires_at_epoch(UNIX 秒)を TTL にして、complete されなかった行も消えるようにする。

「話し始めた」通知を最後に送った時刻(notifications.py の間隔の判定):
- room_id を `notify-speaking#<room_id>`、event_id を受け手の user_id にする。仮の行と同じく、
  履歴のパーティションと混ざらない。
- sent_at_epoch(UNIX 秒)に送った時刻を持つ。条件付きの UpdateItem で「前回が間隔より前
  (か、行がない)なら更新する」とし、更新できた受け手にだけ送る。同時に呼ばれても、
  更新に勝つのは1回だけなので二重に送らない。
- TTL(expires_at_epoch)は間隔が過ぎたあとにする。TTL の削除は遅れることがあるが、判定は
  sent_at_epoch で行うので、消えるのが遅れても結果は変わらない。
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from voice_intercom_api import media_store, store
from voice_intercom_api.config import get_timeline_settings
from voice_intercom_api.timeline_models import (
    PutTimelineEventRequest,
    TimelineEvent,
    TimelineMedia,
)

# 仮の行を残す長さ。署名付き URL の期限(1時間)より十分長くする
PENDING_UPLOAD_TTL = timedelta(days=1)

# 仮の行の TTL の属性名(infra/envs/<env>/main.tf の timeline テーブルの ttl_attribute と揃える)
TTL_ATTRIBUTE = "expires_at_epoch"

_PENDING_PREFIX = "media-upload#"
_SPEAKING_NOTIFY_PREFIX = "notify-speaking#"

# 通知の時刻の行を、間隔が過ぎてからどれだけ残すか(TTL)
_SPEAKING_NOTIFY_TTL_MARGIN = timedelta(hours=1)


def _timeline() -> Any:
    return store._table(get_timeline_settings().timeline_table)  # pyright: ignore[reportPrivateUsage]


def make_event_id(occurred_at: str, source_id: str) -> str:
    return f"{occurred_at}#{source_id}"


def _optional_int(value: Any) -> int | None:
    # DynamoDB の数は Decimal で返る
    return None if value is None else int(value)


def _to_event(item: dict[str, Any]) -> TimelineEvent:
    media = item.get("media")
    is_media = item["kind"] == "media"
    return TimelineEvent(
        room_id=item["room_id"],
        event_id=item["event_id"],
        kind=item["kind"],
        sender_id=item["sender_id"],
        occurred_at=item["occurred_at"],
        # 画像・動画に添えた文は返さない(前に保存した行も)
        language=None if is_media else item.get("language"),
        text="" if is_media else item.get("text", ""),
        translations=item.get("translations", {}),
        utterance_id=item.get("utterance_id"),
        segment_index=item.get("segment_index"),
        media=None
        if media is None
        else TimelineMedia(
            media_id=media["media_id"],
            content_type=media["content_type"],
            url=media_store.public_url(media_store.media_key(item["room_id"], media["media_id"])),
            thumbnail_url=media_store.public_url(
                media_store.thumbnail_key(item["room_id"], media["media_id"])
            )
            if media.get("has_thumbnail")
            else None,
            size_bytes=media["size_bytes"],
            width=_optional_int(media.get("width")),
            height=_optional_int(media.get("height")),
            duration_ms=_optional_int(media.get("duration_ms")),
        ),
    )


def _without_none(item: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if v is not None}


# 履歴


def put_event(room_id: str, source_id: str, body: PutTimelineEventRequest) -> TimelineEvent:
    """発話かテキスト入力を保存する。同じ room_id と event_id なら置き換える(冪等)。"""
    item = _without_none(
        {
            "room_id": room_id,
            "event_id": make_event_id(body.occurred_at, source_id),
            "kind": body.kind,
            "sender_id": body.sender_id,
            "occurred_at": body.occurred_at,
            "language": body.language,
            "text": body.text,
            "translations": body.translations,
            "utterance_id": body.utterance_id,
            "segment_index": body.segment_index,
        }
    )
    _timeline().put_item(Item=item)
    return _to_event(item)


def get_event(room_id: str, event_id: str) -> TimelineEvent | None:
    item = _timeline().get_item(Key={"room_id": room_id, "event_id": event_id}).get("Item")
    return None if item is None else _to_event(item)


def list_events(
    room_id: str, *, limit: int, before: str | None
) -> tuple[list[TimelineEvent], str | None]:
    """新しい順に limit 件まで。before を渡すと、それより古いものだけにする。

    続きがあるかを確かめるため、1件多く読む。
    続きがあれば、最後の event_id を next_before にして返す。
    """
    condition = Key("room_id").eq(room_id)
    if before is not None:
        condition &= Key("event_id").lt(before)
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": condition,
        "ScanIndexForward": False,
    }
    items: list[dict[str, Any]] = []
    # 1回の Query は 1MB で切れるので、足りなければ続きを読む
    while len(items) <= limit:
        res = _timeline().query(Limit=limit + 1 - len(items), **kwargs)
        items.extend(res.get("Items", []))
        if "LastEvaluatedKey" not in res:
            break
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    page = [_to_event(item) for item in items[:limit]]
    next_before = page[-1].event_id if len(items) > limit else None
    return page, next_before


# アップロード中のメディア


@dataclass(frozen=True)
class PendingUpload:
    room_id: str
    media_id: str
    uploader_id: str
    content_type: str
    size_bytes: int
    has_thumbnail: bool
    completed_event_id: str | None
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None


def _pending_key(room_id: str, media_id: str) -> dict[str, str]:
    return {"room_id": _PENDING_PREFIX + room_id, "event_id": media_id}


def create_pending_upload(
    room_id: str,
    media_id: str,
    *,
    uploader_id: str,
    content_type: str,
    size_bytes: int,
    has_thumbnail: bool,
    width: int | None = None,
    height: int | None = None,
    duration_ms: int | None = None,
) -> None:
    now = datetime.now(UTC)
    _timeline().put_item(
        Item=_pending_key(room_id, media_id)
        | _without_none(
            {
                "uploader_id": uploader_id,
                "content_type": content_type,
                "size_bytes": size_bytes,
                "has_thumbnail": has_thumbnail,
                "width": width,
                "height": height,
                "duration_ms": duration_ms,
                "created_at": store.now(),
                TTL_ATTRIBUTE: int((now + PENDING_UPLOAD_TTL).timestamp()),
            }
        )
    )


def get_pending_upload(room_id: str, media_id: str) -> PendingUpload | None:
    item = _timeline().get_item(Key=_pending_key(room_id, media_id)).get("Item")
    if item is None:
        return None
    return PendingUpload(
        room_id=room_id,
        media_id=media_id,
        uploader_id=item["uploader_id"],
        content_type=item["content_type"],
        size_bytes=int(item["size_bytes"]),
        has_thumbnail=bool(item["has_thumbnail"]),
        completed_event_id=item.get("completed_event_id"),
        width=_optional_int(item.get("width")),
        height=_optional_int(item.get("height")),
        duration_ms=_optional_int(item.get("duration_ms")),
    )


class AlreadyCompletedError(Exception):
    """別の complete が先に履歴を書いた。"""

    def __init__(self, event_id: str) -> None:
        super().__init__(event_id)
        self.event_id = event_id


def complete_upload(pending: PendingUpload, *, sender_id: str, occurred_at: str) -> TimelineEvent:
    """メディアの履歴を書き、仮の行に completed_event_id を書く。

    2つを1つのトランザクションにし、同時に2回 complete されても履歴が2件にならないようにする。
    先を越されたら AlreadyCompletedError(先に書かれた event_id を持つ)。
    """
    table_name = get_timeline_settings().timeline_table
    event_id = make_event_id(occurred_at, pending.media_id)
    item = _without_none(
        {
            "room_id": pending.room_id,
            "event_id": event_id,
            "kind": "media",
            "sender_id": sender_id,
            "occurred_at": occurred_at,
            "translations": {},
            "media": _without_none(
                {
                    "media_id": pending.media_id,
                    "content_type": pending.content_type,
                    "size_bytes": pending.size_bytes,
                    "has_thumbnail": pending.has_thumbnail,
                    "width": pending.width,
                    "height": pending.height,
                    "duration_ms": pending.duration_ms,
                }
            ),
        }
    )
    # リソースの meta.client は、Table と同じく Python の値を DynamoDB の型に直してくれる
    client = _timeline().meta.client
    try:
        client.transact_write_items(
            TransactItems=[
                {"Put": {"TableName": table_name, "Item": item}},
                {
                    "Update": {
                        "TableName": table_name,
                        "Key": _pending_key(pending.room_id, pending.media_id),
                        "UpdateExpression": "SET completed_event_id = :event_id",
                        "ConditionExpression": "attribute_exists(uploader_id) "
                        "AND attribute_not_exists(completed_event_id)",
                        "ExpressionAttributeValues": {":event_id": event_id},
                    }
                },
            ]
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "TransactionCanceledException":
            raise
        latest = get_pending_upload(pending.room_id, pending.media_id)
        if latest is None or latest.completed_event_id is None:
            raise
        raise AlreadyCompletedError(latest.completed_event_id) from e
    return _to_event(item)


# 「話し始めた」通知を最後に送った時刻


def _speaking_notify_key(room_id: str, recipient_id: str) -> dict[str, str]:
    return {"room_id": _SPEAKING_NOTIFY_PREFIX + room_id, "event_id": recipient_id}


def claim_speaking_notification(
    room_id: str, recipient_id: str, *, now_epoch: int, interval_s: int
) -> bool:
    """前回の送信から interval_s 秒以上たっていれば、送信の時刻を now_epoch にして True を返す。

    間隔の内側(か、同時に呼ばれた別のリクエストが先に更新した)なら False。
    """
    expires_at = now_epoch + interval_s + int(_SPEAKING_NOTIFY_TTL_MARGIN.total_seconds())
    try:
        _timeline().update_item(
            Key=_speaking_notify_key(room_id, recipient_id),
            UpdateExpression="SET sent_at_epoch = :now, #ttl = :ttl",
            ConditionExpression="attribute_not_exists(sent_at_epoch) "
            "OR sent_at_epoch <= :threshold",
            ExpressionAttributeNames={"#ttl": TTL_ATTRIBUTE},
            ExpressionAttributeValues={
                ":now": now_epoch,
                ":ttl": expires_at,
                ":threshold": now_epoch - interval_s,
            },
        )
    except ClientError as e:
        if store._is_conditional_check_failed(e):  # pyright: ignore[reportPrivateUsage]
            return False
        raise
    return True


def release_speaking_notification(room_id: str, recipient_id: str, *, now_epoch: int) -> None:
    """claim を取り消す(送れなかったとき、次の呼び出しで送れるように)。

    別のリクエストが後から書き直していたら、そのままにする。
    """
    try:
        _timeline().delete_item(
            Key=_speaking_notify_key(room_id, recipient_id),
            ConditionExpression="sent_at_epoch = :now",
            ExpressionAttributeValues={":now": now_epoch},
        )
    except ClientError as e:
        if not store._is_conditional_check_failed(e):  # pyright: ignore[reportPrivateUsage]
            raise
