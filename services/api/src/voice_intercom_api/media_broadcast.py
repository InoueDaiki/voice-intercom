"""complete で履歴に保存した画像・動画を、ルームに知らせる。

docs/設計メモ.md の「画像・動画のルームへの配信」の B(API が送る)。

1. LiveKit の RoomService.ListParticipants で、今ルームにいる参加者を取る。
2. 人(kind が STANDARD)がいれば、RoomService.SendData で topic "media"、reliable、宛先なし
   (ルームの全員)に MediaMessage(proto/voiceintercom/v1/media.proto)を送る。
   いなければ送らない(livekit-server 1.13.9 では、無いルームへの SendData は 3 秒待って
   503 になる)。
3. 最初の complete のときだけ、ルームのメンバーから、送信者と今ルームにいる人を除いた人に
   push 通知を送る。

- 送信者は JWT の sub、中身は保存した履歴の行から作る。参加者は書き換えられない。
- 2回目の complete でも 1 と 2 は行う(1回目の配信が失敗したときに、やり直せば届くように)。
  受け手は event_id で重複を捨てる。push 通知は受け手の OS がそのまま出すので、2回目では送らない。
- どれが失敗しても例外は外に出さず、ログに残す。complete は履歴を 200 で返す
  (履歴に残っているので、入り直したときや履歴を開いたときに見られる)。
- ListParticipants が失敗したら(LiveKit に届かないなど)、配信は飛ばし、push 通知は
  送信者以外のメンバー全員に送る(今ルームにいる人が分からないため)。
- 時間: LiveKit の呼び出しは1回 LIVEKIT_TIMEOUT_S 秒、push 通知は PUSH_TIMEOUT_S 秒で待つのを
  やめる。合わせて 12 秒で、S3 と DynamoDB の読み書きを足しても Lambda の timeout(15秒)に収める。
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import aiohttp
from livekit import api as livekit
from livekit.api.room_service import RoomService

from voice_intercom_api import notify
from voice_intercom_api.config import get_settings
from voice_intercom_api.models import Room, User
from voice_intercom_api.timeline_models import TimelineEvent
from voiceintercom.v1.media_pb2 import MediaMessage

logger = logging.getLogger(__name__)

# データチャネルの topic(アプリはこの topic の、送信元の参加者が無いデータだけを読む)
TOPIC = "media"

# MediaMessage の text の上限(UTF-8 のバイト数)。reliable のデータを小さく保つため
MAX_TEXT_BYTES = 4096

# LiveKit の Server API の1回の待ち時間(秒)。ローカルの livekit-server では 1ms 前後で返る
LIVEKIT_TIMEOUT_S = 2.0

# push 通知を待つ長さ(秒)
PUSH_TIMEOUT_S = 8.0

# push 通知の本文に足す、添えた文の先頭の文字数
PUSH_TEXT_CHARS = 50

NOTIFICATION_TYPE = "media"


def truncate_utf8(text: str, max_bytes: int) -> tuple[str, bool]:
    """UTF-8 で max_bytes に収まるよう、文字の途中で切らずに先頭を返す。切ったら True。"""
    encoded = text.encode()
    if len(encoded) <= max_bytes:
        return text, False
    return encoded[:max_bytes].decode(errors="ignore"), True


def build_message(event: TimelineEvent) -> MediaMessage:
    """履歴の行(kind が media)から MediaMessage を作る。"""
    media = event.media
    if media is None:
        raise ValueError("media の履歴ではない")
    text, truncated = truncate_utf8(event.text, MAX_TEXT_BYTES)
    return MediaMessage(
        event_id=event.event_id,
        sender_identity=event.sender_id,
        occurred_at=event.occurred_at,
        media_id=media.media_id,
        content_type=media.content_type,
        url=media.url,
        thumbnail_url=media.thumbnail_url or "",
        size_bytes=media.size_bytes,
        text=text,
        text_truncated=truncated,
        language=event.language or "",
    )


@asynccontextmanager
async def _room_service() -> AsyncIterator[RoomService]:
    settings = get_settings()
    # Server API の URL は、アプリの接続先と同じ(ws/wss は SDK が http/https に読み替える)
    async with livekit.LiveKitAPI(
        settings.livekit_client_url,
        settings.livekit_api_key,
        settings.livekit_api_secret,
        timeout=aiohttp.ClientTimeout(total=LIVEKIT_TIMEOUT_S),
    ) as lk:
        yield lk.room


async def _list_and_send(room_id: str, payload: bytes) -> list[str] | None:
    """今ルームにいる人の identity を返し、人がいれば payload を送る。取れなければ None。"""
    async with _room_service() as room:
        try:
            res = await room.list_participants(livekit.ListParticipantsRequest(room=room_id))
        except livekit.ServerError as e:
            # livekit-server 1.13.9 は、無いルームでも空の一覧を返す。not_found を返す版にも備える
            if e.code == livekit.ServerErrorCode.NOT_FOUND:
                return []
            raise
        present = [
            p.identity for p in res.participants if p.kind == livekit.ParticipantInfo.Kind.STANDARD
        ]
        if not present:
            # Agent しかいない、か誰もいない
            return present
        try:
            await room.send_data(
                livekit.SendDataRequest(
                    room=room_id,
                    data=payload,
                    kind=livekit.DataPacket.Kind.RELIABLE,
                    topic=TOPIC,
                )
            )
        except Exception:
            logger.exception("画像・動画をルームに配信できなかった: room=%s", room_id)
        return present


def broadcast(event: TimelineEvent) -> list[str] | None:
    """今ルームにいる人に MediaMessage を送り、その人たちの identity を返す。

    今ルームにいる人を取れなかったら None(配信もしない)。
    """
    payload = build_message(event).SerializeToString()
    try:
        return asyncio.run(_list_and_send(event.room_id, payload))
    except Exception:
        logger.exception("ルームの参加者を取れなかった: room=%s", event.room_id)
        return None


def push_body(event: TimelineEvent, sender: User | None) -> str:
    """push 通知の本文。「<表示名>さんが画像を送りました」に、添えた文の先頭を足す。"""
    media = event.media
    what = "動画" if media is not None and media.content_type.startswith("video/") else "画像"
    who = "誰か" if sender is None else f"{sender.display_name}さん"
    body = f"{who}が{what}を送りました"
    text = event.text.strip()
    if text:
        head = text[:PUSH_TEXT_CHARS] + ("…" if len(text) > PUSH_TEXT_CHARS else "")
        body += f": {head}"
    return body


def notify_absent(
    room: Room, event: TimelineEvent, sender: User | None, present: list[str] | None
) -> None:
    """ルームのメンバーから、送信者と今ルームにいる人を除いた人に push 通知を送る。"""
    excluded = {event.sender_id, *(present or [])}
    recipients = [uid for uid in dict.fromkeys(room.member_ids) if uid not in excluded]
    if not recipients:
        return
    notify.send_to_users_within(
        recipients,
        title=room.name,
        body=push_body(event, sender),
        data={"type": NOTIFICATION_TYPE, "room_id": room.room_id, "event_id": event.event_id},
        timeout_s=PUSH_TIMEOUT_S,
        label="画像・動画",
    )


def announce(room: Room, event: TimelineEvent, sender: User | None, *, first: bool) -> None:
    """ルームに配信し、first なら push 通知も送る。例外は外に出さない。"""
    try:
        present = broadcast(event)
        if first:
            notify_absent(room, event, sender, present)
    except Exception:
        logger.exception("画像・動画をルームに知らせられなかった: room=%s", room.room_id)
