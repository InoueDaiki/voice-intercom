"""送った本人が消した履歴の行(テキスト入力、画像・動画)の後始末。

docs/設計メモ.md の「送ったものの削除」。DELETE /rooms/{room_id}/timeline/event(timeline.py)が
行を墓石にした後に呼ぶ。

1. 今ルームにいる人へ、データチャネル(topic "deletion"、reliable)で DeletionMessage
   (proto/voiceintercom/v1/deletion.proto)を送る。送り方は画像・動画の配信と同じ
   (media_broadcast.send_to_room。人がいなければ送らない)。
2. 画像・動画なら、S3 の本体とサムネイルを消す。
3. 消せたら、CloudFront のキャッシュを無効にする(media_id ごとに1つのパス
   `/rooms/<room_id>/<media_id>/*`)。キャッシュの期間は Managed-CachingOptimized の既定の
   24時間で、URL は署名なしなので、無効にしないと消した後も最大24時間は読める。

- どれが失敗しても例外は外に出さず、ログに残す。DELETE は墓石を 200 で返す(履歴からは
  もう読めない)。2回目の DELETE でも 1〜3 を行うので、失敗したらやり直せる。
- 無効化の CallerReference は `delete-<media_id>` にする。2回目の DELETE で同じ無効化を作り直さない
  (CloudFront は同じ CallerReference なら前のものを返す)。
- push 通知は取り消さない(届いたものは消せない)。
"""

import logging

from voice_intercom_api import media_broadcast, media_store, timeline_store
from voice_intercom_api.timeline_models import TimelineEvent
from voiceintercom.v1.deletion_pb2 import DeletionMessage

logger = logging.getLogger(__name__)

# データチャネルの topic(アプリはこの topic を、履歴で確かめてから表示に使う)
TOPIC = "deletion"


def build_message(event: TimelineEvent) -> DeletionMessage:
    """墓石の行から DeletionMessage を作る。"""
    deleted = event.deleted
    if deleted is None:
        raise ValueError("消した行ではない")
    return DeletionMessage(
        event_id=event.event_id,
        sender_identity=event.sender_id,
        kind=event.kind,
        message_id=event.message_id or "",
        deleted_at=deleted.deleted_at,
    )


def announce(event: TimelineEvent) -> None:
    """今ルームにいる人に知らせる。例外は外に出さない。"""
    try:
        media_broadcast.send_to_room(
            event.room_id, build_message(event).SerializeToString(), topic=TOPIC
        )
    except Exception:
        logger.exception("消した知らせをルームに送れなかった: room=%s", event.room_id)


def purge_media(event: TimelineEvent) -> None:
    """消した画像・動画の、S3 の本体とサムネイルを消し、CloudFront のキャッシュを無効にする。"""
    try:
        media = timeline_store.deleted_media(event.room_id, event.event_id)
        if media is None:
            return
        keys = [media_store.media_key(event.room_id, media.media_id)]
        if media.has_thumbnail:
            keys.append(media_store.thumbnail_key(event.room_id, media.media_id))
        media_store.delete(keys)
        media_store.invalidate(
            [f"/{media_store.media_prefix(event.room_id, media.media_id)}*"],
            caller_reference=f"delete-{media.media_id}",
        )
    except Exception:
        logger.exception(
            "消した画像・動画を S3 か CloudFront から消せなかった: room=%s event=%s",
            event.room_id,
            event.event_id,
        )


def after_delete(event: TimelineEvent) -> None:
    """墓石にした後の後始末。知らせを先に送る(ルームの表示を早く変えるため)。"""
    announce(event)
    if event.kind == "media":
        purge_media(event)
