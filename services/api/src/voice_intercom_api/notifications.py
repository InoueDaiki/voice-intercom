"""ルームでの出来事を、ルームにいないメンバーに push 通知する API(Agent が呼ぶ)。

- 話し始め(POST /rooms/{room_id}/notifications/speaking): Agent が、ルームで誰かが話し始めた
  (ミュートを外した)のを見つけたら呼ぶ。本文は「<話者>さんが話しています」。
- テキスト入力(POST /rooms/{room_id}/notifications/text): Agent が、データチャネルで届いた
  テキストを受け付けたら呼ぶ。本文は「<送信者>さん: <テキストの先頭>」。
  テキストはアプリから Agent にだけ届き、API は履歴の保存(訳がそろってから)まで知らないので、
  話し始めと同じく Agent から知らせる。

- 送る相手は、ルームの member_ids から、送信者(話者)と今ルームに入っている人(present_ids)を
  除いた人。
- 間引きは room_push.py: 同じルーム × 同じ受け手には、NOTIFY_INTERVAL_S 秒(既定 300)に1回まで。
  通知の種類(テキスト、話し始め、画像・動画)は分けずに数える。会話が続く間、発話やテキストの
  たびに通知が鳴り続けないようにする。
- 送信の失敗(サービスアカウントが未設定、FCM の失敗など)では 500 にせず、ログに残して
  sent を 0 にする。
- 送信は API の Lambda の timeout(15秒)に収まるよう、SEND_TIMEOUT_S 秒で待つのをやめて応答する。
  Agent は応答を待たずに次へ進む前提なので、待ちきれなかった送信は届かなくてもよい。
"""

import logging
from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.openapi.params import Body
from pydantic import BaseModel, Field

from voice_intercom_api import room_push, store
from voice_intercom_api.auth import AgentPrincipal
from voice_intercom_api.routing import AUTH, ROOM_NOT_FOUND, RoomIdPath, existing_room, responses

logger = logging.getLogger(__name__)

router = Router()

# 送信を待つ長さ(秒)。claim などの DynamoDB の読み書きと合わせて、Lambda の timeout(15秒)に収める
SEND_TIMEOUT_S = 10.0

# プロフィールが無い話者のときの本文
UNKNOWN_SPEAKER_BODY = "誰かが話しています"
# プロフィールが無い送信者の呼び方(テキスト)
UNKNOWN_SENDER = "誰か"

# テキストの通知の本文に入れる、テキストの先頭の文字数
PUSH_TEXT_CHARS = 50

SPEAKING_TYPE = "speaking"
TEXT_TYPE = "text"

PresentIds = Annotated[
    list[str],
    Field(
        max_length=500,
        description="今ルームに入っている人の user_id(sub)。この人たちには送らない",
    ),
]


class SpeakingNotificationRequest(BaseModel):
    speaker_id: str = Field(min_length=1, max_length=128, description="話者の user_id(sub)")
    present_ids: PresentIds = []


class TextNotificationRequest(BaseModel):
    sender_id: str = Field(min_length=1, max_length=128, description="送信者の user_id(sub)")
    present_ids: PresentIds = []
    text: str = Field(
        min_length=1, max_length=10000, description="送られたテキスト(本文には先頭だけを入れる)"
    )


class NotificationResult(BaseModel):
    sent: int = Field(description="送った人数")
    skipped: int = Field(description="前回の通知から間隔がたっていないので、送らなかった人数")


@router.post(
    "/rooms/<room_id>/notifications/speaking",
    summary="誰かが話し始めたことを、ルームにいないメンバーに push 通知する(Agent)",
    description="ルームのメンバーから、話者と present_ids を除いた人に送る。"
    "同じルーム × 同じ受け手には、間隔(既定 300 秒。テキスト・画像・動画の通知と共通)に1回まで。"
    "送信に失敗しても 500 にはせず、sent を 0 にして返す。",
    operation_id="notifySpeaking",
    tags=["notifications"],
    security=AUTH,
    responses=responses(NotificationResult, errors=ROOM_NOT_FOUND),
)
def notify_speaking(
    room_id: RoomIdPath,
    body: Annotated[SpeakingNotificationRequest, Body()],
    _agent: AgentPrincipal,
) -> NotificationResult:
    room = existing_room(room_id)
    recipients = room_push.recipients_of(room.member_ids, [body.speaker_id, *body.present_ids])
    if not recipients:
        return NotificationResult(sent=0, skipped=0)
    profile = store.get_user(body.speaker_id)
    message = (
        UNKNOWN_SPEAKER_BODY if profile is None else f"{profile.display_name}さんが話しています"
    )
    outcome = room_push.send_throttled(
        room_id,
        recipients,
        title=room.name,
        body=message,
        data={"type": SPEAKING_TYPE, "room_id": room_id},
        timeout_s=SEND_TIMEOUT_S,
        label="話し始め",
    )
    return NotificationResult(sent=outcome.sent, skipped=outcome.skipped)


def text_body(sender_name: str | None, text: str) -> str:
    """テキストの通知の本文。「<表示名>さん: <テキストの先頭>」。改行と続く空白は1つにする。"""
    who = UNKNOWN_SENDER if sender_name is None else f"{sender_name}さん"
    text = " ".join(text.split())
    head = text[:PUSH_TEXT_CHARS] + ("…" if len(text) > PUSH_TEXT_CHARS else "")
    return f"{who}: {head}"


@router.post(
    "/rooms/<room_id>/notifications/text",
    summary="テキスト入力が届いたことを、ルームにいないメンバーに push 通知する(Agent)",
    description="ルームのメンバーから、送信者と present_ids を除いた人に送る。"
    "本文は「<表示名>さん: <テキストの先頭>」。"
    "同じルーム × 同じ受け手には、間隔(既定 300 秒。話し始め・画像・動画の通知と共通)に1回まで。"
    "送信に失敗しても 500 にはせず、sent を 0 にして返す。",
    operation_id="notifyText",
    tags=["notifications"],
    security=AUTH,
    responses=responses(NotificationResult, errors=ROOM_NOT_FOUND),
)
def notify_text(
    room_id: RoomIdPath,
    body: Annotated[TextNotificationRequest, Body()],
    _agent: AgentPrincipal,
) -> NotificationResult:
    room = existing_room(room_id)
    recipients = room_push.recipients_of(room.member_ids, [body.sender_id, *body.present_ids])
    if not recipients:
        return NotificationResult(sent=0, skipped=0)
    profile = store.get_user(body.sender_id)
    outcome = room_push.send_throttled(
        room_id,
        recipients,
        title=room.name,
        body=text_body(None if profile is None else profile.display_name, body.text),
        data={"type": TEXT_TYPE, "room_id": room_id},
        timeout_s=SEND_TIMEOUT_S,
        label="テキスト",
    )
    return NotificationResult(sent=outcome.sent, skipped=outcome.skipped)
