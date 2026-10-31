"""ルームに何か届いたときの push 通知を、受け手 × ルームで間引いて送る。

テキスト入力・話し始め(notifications.py。Agent が呼ぶ)と、画像・動画(media_broadcast.py。
complete から)が使う。docs/設計メモ.md の「push 通知の間引き」。

- 同じルーム × 同じ受け手には、NOTIFY_INTERVAL_S 秒(既定 300)に1回まで。最初の1件はすぐ送り、
  そこから間隔のあいだは、その受け手に同じルームの通知を送らない。通知の種類(テキスト、
  話し始め、画像・動画)は分けずに数える。別のルームは別に数える。
- 受け手ごとの最後の送信時刻は、timeline テーブルの別のパーティション(`notify#<room_id>`)に
  置き、条件付きの UpdateItem で決める(timeline_store.py の claim_notifications)。
  同時に呼ばれても、更新に勝つのは1回だけなので二重に送らない。行は TTL で消える。
- 送れないと分かっているとき(サービスアカウントが未設定・読めない)は、時刻を取らない
  (取ると、設定を直しても間隔のあいだ送れない)。
- 送り終えなかった受け手は、取った時刻を戻し、次の通知で送れるようにする。送信が例外で
  失敗したときと、待ちきれなかった(timeout_s を過ぎた)ときが当たる。待ちきれなかった送信は
  打ち切る(notify.py の send_to_users_within)。Lambda は応答を返すと実行環境を止めるので、
  続くものとして時刻を残すと、その受け手には通知が届かないまま間隔のあいだ送れなくなる。
  送り終えた受け手(FCM が失敗した人も含む)の時刻は残す。
- 例外は外に出さない。送れなかったときは sent を 0 にする。
- 時間: 受け手ごとに UpdateItem を1回(同じリージョンで数 ms)。送信は timeout_s 秒で待つのを
  やめる。呼び出し側は、ほかの処理と合わせて API の Lambda の timeout(15秒)に収める。
"""

import logging
import os
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from voice_intercom_api import notify, timeline_store

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_S = 300


@dataclass(frozen=True)
class PushOutcome:
    # 送り終えた人数(端末を登録していない人、FCM が失敗した人も含む)
    sent: int = 0
    # 前回の通知から間隔がたっていないので、送らなかった人数
    skipped: int = 0


def interval_s() -> int:
    """同じルーム × 同じ受け手に送る間隔(秒)。"""
    raw = os.environ.get("NOTIFY_INTERVAL_S", "")
    return int(raw) if raw else DEFAULT_INTERVAL_S


def recipients_of(member_ids: Iterable[str], excluded: Iterable[str]) -> list[str]:
    """メンバー(store.current_member_ids)から、excluded(送信者と今ルームにいる人)を除いた人。

    重ねずに順に返す。
    """
    skip = set(excluded)
    return [uid for uid in dict.fromkeys(member_ids) if uid not in skip]


def send_throttled(
    room_id: str,
    recipients: list[str],
    *,
    title: str,
    body: str,
    data: Mapping[str, str],
    timeout_s: float,
    label: str,
) -> PushOutcome:
    """間隔の外にいる受け手にだけ送る。label はログに出す通知の名前。"""
    if not recipients:
        return PushOutcome()
    try:
        notify.service_account()
    except Exception:
        logger.exception("FCM が使えないので、%sの通知を送らない: room=%s", label, room_id)
        return PushOutcome()

    now_epoch = int(time.time())
    try:
        claimed = timeline_store.claim_notifications(
            room_id, recipients, now_epoch=now_epoch, interval_s=interval_s()
        )
    except Exception:
        logger.exception(
            "通知の時刻を取れなかったので、%sの通知を送らない: room=%s", label, room_id
        )
        return PushOutcome()
    skipped = len(recipients) - len(claimed)
    if not claimed:
        logger.info("%sの通知を間引いた: room=%s skipped=%d", label, room_id, skipped)
        return PushOutcome(skipped=skipped)

    done = notify.send_to_users_within(
        claimed, title=title, body=body, data=data, timeout_s=timeout_s, label=label
    )
    rest = [uid for uid in claimed if uid not in done]
    if rest:
        try:
            timeline_store.release_notifications(room_id, rest, now_epoch=now_epoch)
        except Exception:
            logger.exception("通知の時刻を戻せなかった: room=%s", room_id)
    return PushOutcome(sent=len(claimed) - len(rest), skipped=skipped)
