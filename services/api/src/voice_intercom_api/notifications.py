"""「誰かが話し始めた」ときの push 通知の API。

Agent が、ルームで誰かが話し始めたのを見つけたら呼ぶ。今ルームに入っていないメンバーに
「<話者>さんが話しています」と送り、アプリを開いて聞きに来てもらう。

- 送る相手は、ルームの member_ids から、話者と今ルームに入っている人(present_ids)を除いた人。
- 同じルーム × 同じ受け手には、SPEAKING_NOTIFY_INTERVAL_S 秒(既定 600)に1回まで。
  会話が続く間、発話のたびに通知が鳴り続けないようにする。
- 間隔は timeline テーブルの別のパーティション(`notify-speaking#<room_id>`)に、受け手ごとの
  最後の送信時刻を置き、条件付きの UpdateItem で決める(timeline_store.py)。
  - テーブルを増やさずに済み、media.py の仮の行と同じく TTL で消える。
  - rooms や users の項目に持たせると、ルームの PATCH やプロフィールの PUT と同じ項目を
    取り合ううえ、users では受け手 × ルームの数だけ属性が増える。
  - 条件付き書き込みなので、Agent が同時に2回呼んでも、送るのは1回になる。
- 送信の失敗(サービスアカウントが未設定、FCM の失敗など)では 500 にせず、ログに残して
  sent を 0 にする。送れなかったときは、取った時刻を戻し、次の呼び出しで送れるようにする。
- 送信は API の Lambda の timeout(15秒)に収まるよう、SEND_TIMEOUT_S 秒で待つのをやめて応答する。
  Agent は応答を待たずに次へ進む前提なので、待ちきれなかった送信は届かなくてもよい。
"""

import logging
import os
import threading
import time
from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.openapi.params import Body
from pydantic import BaseModel, Field

from voice_intercom_api import notify, store, timeline_store
from voice_intercom_api.auth import AgentPrincipal
from voice_intercom_api.routing import AUTH, ROOM_NOT_FOUND, RoomIdPath, existing_room, responses

logger = logging.getLogger(__name__)

router = Router()

DEFAULT_INTERVAL_S = 600

# 送信を待つ長さ(秒)。claim などの DynamoDB の読み書きと合わせて、Lambda の timeout(15秒)に収める
SEND_TIMEOUT_S = 10.0

# 表示名が分からないときの話者の呼び方
UNKNOWN_SPEAKER = "誰か"

NOTIFICATION_TYPE = "speaking"


class SpeakingNotificationRequest(BaseModel):
    speaker_id: str = Field(min_length=1, max_length=128, description="話者の user_id(sub)")
    present_ids: list[str] = Field(
        default=[],
        max_length=500,
        description="今ルームに入っている人の user_id(sub)。この人たちには送らない",
    )


class SpeakingNotificationResult(BaseModel):
    sent: int = Field(description="送った人数")
    skipped: int = Field(description="前回の通知から間隔がたっていないので、送らなかった人数")


def interval_s() -> int:
    """同じルーム × 同じ受け手に送る間隔(秒)。"""
    raw = os.environ.get("SPEAKING_NOTIFY_INTERVAL_S", "")
    return int(raw) if raw else DEFAULT_INTERVAL_S


@router.post(
    "/rooms/<room_id>/notifications/speaking",
    summary="誰かが話し始めたことを、ルームにいないメンバーに push 通知する(Agent)",
    description="ルームのメンバーから、話者と present_ids を除いた人に送る。"
    "同じルーム × 同じ受け手には、間隔(既定 600 秒)に1回まで。"
    "送信に失敗しても 500 にはせず、sent を 0 にして返す。",
    operation_id="notifySpeaking",
    tags=["notifications"],
    security=AUTH,
    responses=responses(SpeakingNotificationResult, errors=ROOM_NOT_FOUND),
)
def notify_speaking(
    room_id: RoomIdPath,
    body: Annotated[SpeakingNotificationRequest, Body()],
    _agent: AgentPrincipal,
) -> SpeakingNotificationResult:
    room = existing_room(room_id)
    excluded = {body.speaker_id, *body.present_ids}
    recipients = [uid for uid in dict.fromkeys(room.member_ids) if uid not in excluded]
    if not recipients:
        return SpeakingNotificationResult(sent=0, skipped=0)

    # 送れないと分かっているときは、時刻を取らない(取ると、設定を直しても間隔のあいだ送れない)
    try:
        notify.service_account()
    except Exception:
        logger.exception("FCM が使えないので、話し始めの通知を送らない: room=%s", room_id)
        return SpeakingNotificationResult(sent=0, skipped=0)

    now_epoch = int(time.time())
    interval = interval_s()
    claimed: list[str] = []
    for uid in recipients:
        if timeline_store.claim_speaking_notification(
            room_id, uid, now_epoch=now_epoch, interval_s=interval
        ):
            claimed.append(uid)
    skipped = len(recipients) - len(claimed)
    if not claimed:
        return SpeakingNotificationResult(sent=0, skipped=skipped)

    profile = store.get_user(body.speaker_id)
    speaker_name = UNKNOWN_SPEAKER if profile is None else profile.display_name
    ok = _send_with_timeout(
        claimed,
        title=room.name,
        body=f"{speaker_name}さんが話しています",
        data={"type": NOTIFICATION_TYPE, "room_id": room_id},
    )
    if not ok:
        for uid in claimed:
            try:
                timeline_store.release_speaking_notification(room_id, uid, now_epoch=now_epoch)
            except Exception:
                logger.exception("通知の時刻を戻せなかった: room=%s user=%s", room_id, uid)
        return SpeakingNotificationResult(sent=0, skipped=skipped)
    return SpeakingNotificationResult(sent=len(claimed), skipped=skipped)


def _send_with_timeout(user_ids: list[str], *, title: str, body: str, data: dict[str, str]) -> bool:
    """send_to_users を別のスレッドで動かし、SEND_TIMEOUT_S 秒まで待つ。

    例外で失敗したら False。待ちきれなかったときは、送信は続いているものとして True を返す
    (時刻を戻すと、遅れて届いた人にもう一度送ってしまうため)。
    """
    error: list[BaseException] = []

    def run() -> None:
        try:
            result = notify.send_to_users(user_ids, title=title, body=body, data=data)
            logger.info(
                "話し始めの通知を送った: sent=%d failed=%d removed=%d",
                result.sent,
                result.failed,
                result.removed,
            )
        except Exception as e:
            logger.exception("話し始めの通知を送れなかった")
            error.append(e)

    # daemon にして、待ちきれなかったスレッドが応答を止めないようにする
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(SEND_TIMEOUT_S)
    if thread.is_alive():
        logger.warning("話し始めの通知の送信を待ちきれなかった(%s 秒)", SEND_TIMEOUT_S)
        return True
    return not error
