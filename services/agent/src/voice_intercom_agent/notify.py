"""ルームでの出来事(話し始め、テキスト入力)を REST API に知らせ、push 通知を送ってもらう。

- 話し始め(ミュートを外した): POST /rooms/{room_id}/notifications/speaking。
  body は {"speaker_id": 話者の identity, "present_ids": 今ルームにいる人の identity}。
- テキスト入力(受け付けた): POST /rooms/{room_id}/notifications/text。
  body は {"sender_id": 送信者の identity, "present_ids": ..., "text": テキスト}。
- どちらも Agent の client credentials のトークンで呼ぶ。API は、ルームのメンバーのうち
  present_ids に入っていない人(と送信者を除く)に通知を送り、同じルーム × 同じ受け手には
  5分に1回までに絞る(種類は分けずに数える)。
- API の呼び出しを減らすため、Agent でも同じルームについて min_interval_s に1回までにする
  (話し始めとテキストで共通)。間引いたものは呼ばない(API 側で絞られる通知を、後から送り直す
  意味はない)。
- 呼び出しはバックグラウンドのタスクで行い、発話やテキストの処理と字幕を待たせない。
- 通知は遅れて届いても意味が薄いので、通信の失敗(トークンを取れないことを含む)と 5xx だけ
  1回やり直す。401 はトークンを取り直して1回だけやり直す。それ以外はログに残して捨てる。
- API が印を付けて答えた 404 と 409 は、履歴の保存と同じく、ルームがもう使えないという意味なので
  on_room_gone で知らせる(history.py の room_is_gone)。印の無い 404 では閉じない。
  話し始めの通知は発話の書き起こしを待たないので、履歴より先に分かる。
- ジョブの終わり(aclose)に、送り中のものを flush_timeout_s だけ待って打ち切る。

トークンと HTTP のセッションは履歴の保存(history.py)と共有する。設定が無ければ何もしない。
"""

import asyncio
import logging
import os
import time
from collections.abc import Callable, Iterable
from enum import Enum
from typing import Any
from urllib.parse import quote

import aiohttp

from .history import (
    ApiAccess,
    ClientCredentials,
    HistorySettings,
    TokenError,
    room_is_gone,
)

logger = logging.getLogger(__name__)

# 同じルームについて、API を呼ぶ最短の間隔の既定(秒)
DEFAULT_MIN_INTERVAL_S = 30.0
# ジョブの終わりに、送り中の通知を待つ上限(秒)
FLUSH_TIMEOUT_S = 1.5

SPEAKING = "speaking"
TEXT = "text"

# ログに出す通知の名前
_LABELS = {SPEAKING: "話し始め", TEXT: "テキスト"}


def min_interval_from_env() -> float:
    return float(os.environ.get("NOTIFY_MIN_INTERVAL_S", DEFAULT_MIN_INTERVAL_S))


class Throttle:
    """同じルームについて、min_interval_s に1回だけ通す。"""

    def __init__(
        self, min_interval_s: float, *, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._min_interval_s = min_interval_s
        self._clock = clock
        self._last: dict[str, float] = {}

    def allow(self, room_id: str) -> bool:
        """通すなら、その時刻を覚えて True。呼び出しが失敗しても、間隔は空ける。"""
        now = self._clock()
        last = self._last.get(room_id)
        if last is not None and now - last < self._min_interval_s:
            return False
        self._last[room_id] = now
        return True


def present_ids(participants: Iterable[tuple[str, bool]]) -> list[str]:
    """(identity, 人か) の並びから、人の identity を重ねずに順に返す。

    Agent などの人以外の参加者は除く。送信者本人は残してよい(API 側で除く)。
    """
    ids: list[str] = []
    for identity, is_person in participants:
        if is_person and identity and identity not in ids:
            ids.append(identity)
    return ids


class NotifyResult(Enum):
    SENT = "sent"
    # ルームがもう使えない(印つきの 404、409)
    ROOM_GONE = "room_gone"
    # 400、403 など、やり直しても通らない応答
    REJECTED = "rejected"
    # やり直しても通信の失敗か 5xx だった
    FAILED = "failed"


class NotifyClient:
    """POST /rooms/{room_id}/notifications/{kind} を、1回だけのやり直しつきで呼ぶ。"""

    def __init__(
        self,
        http: aiohttp.ClientSession,
        settings: HistorySettings,
        credentials: ClientCredentials,
        *,
        retry_delay_s: float = 0.5,
    ) -> None:
        self._http = http
        self._settings = settings
        self._credentials = credentials
        self._retry_delay_s = retry_delay_s

    async def notify(self, room_id: str, kind: str, body: dict[str, Any]) -> NotifyResult:
        s = self._settings
        url = f"{s.api_base_url}/rooms/{quote(room_id, safe='')}/notifications/{kind}"
        label = _LABELS.get(kind, kind)
        timeout = aiohttp.ClientTimeout(total=s.request_timeout_s)
        reauthorized = False
        retried = False
        while True:
            status: int | None = None
            token = ""
            detail = ""
            try:
                token = await self._credentials.token()
                async with self._http.post(
                    url, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=timeout
                ) as res:
                    status = res.status
                    if 200 <= status < 300:
                        logger.info("%sを通知した: %s %s", label, room_id, await res.text())
                        return NotifyResult.SENT
                    detail = (await res.text())[:500]
            except (aiohttp.ClientError, TimeoutError, TokenError) as e:
                detail = repr(e)

            if status == 401 and not reauthorized:
                # 期限切れや鍵の入れ替えなど。トークンを取り直して1回だけやり直す
                reauthorized = True
                self._credentials.invalidate(token)
                continue
            if room_is_gone(status, detail):
                logger.warning(
                    "%sを通知しない(ルーム %s はもう使えない。%s): %s",
                    label,
                    room_id,
                    status,
                    detail,
                )
                return NotifyResult.ROOM_GONE
            if status is not None and status < 500:
                logger.error("%sの通知が拒まれた(%d): %s %s", label, status, room_id, detail)
                return NotifyResult.REJECTED
            if retried:
                logger.error(
                    "%sを通知できなかった(最後は %s): %s %s",
                    label,
                    status or "通信の失敗",
                    room_id,
                    detail,
                )
                return NotifyResult.FAILED
            retried = True
            logger.warning(
                "%sの通知に失敗した(%s)。%.1f秒後に1回だけやり直す: %s",
                label,
                status or detail,
                self._retry_delay_s,
                room_id,
            )
            await asyncio.sleep(self._retry_delay_s)


class RoomNotifier:
    """ルーム(ジョブ)ごとに1つ。話し始めとテキストを受け取り、間隔を空けて API を呼ぶ。

    client が None なら何もしない(設定が無いとき)。呼び出しはすべてイベントループの中から。
    """

    def __init__(
        self,
        client: NotifyClient | None,
        room_name: Callable[[], str],
        *,
        on_room_gone: Callable[[], None] | None = None,
        min_interval_s: float = DEFAULT_MIN_INTERVAL_S,
        flush_timeout_s: float = FLUSH_TIMEOUT_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        # ルーム名(API の room_id)は接続してから決まるので、呼ぶときに読む
        self._room_name = room_name
        self._on_room_gone = on_room_gone
        # 話し始めとテキストで共通に数える(API の間引きも種類を分けない)
        self._throttle = Throttle(min_interval_s, clock=clock)
        self._flush_timeout_s = flush_timeout_s
        self._tasks: set[asyncio.Task[None]] = set()
        self._closed = False

    def started(self, speaker_id: str, present: list[str]) -> None:
        """発話の開始。間引かれなければ、バックグラウンドで API を呼ぶ。"""
        self._submit(SPEAKING, {"speaker_id": speaker_id, "present_ids": present})

    def text(self, sender_id: str, present: list[str], text: str) -> None:
        """テキストを受け付けた。間引かれなければ、バックグラウンドで API を呼ぶ。"""
        self._submit(TEXT, {"sender_id": sender_id, "present_ids": present, "text": text})

    def _submit(self, kind: str, body: dict[str, Any]) -> None:
        if self._client is None or self._closed:
            return
        room_id = self._room_name()
        if not self._throttle.allow(room_id):
            logger.debug("%sの通知を間引いた: %s", _LABELS[kind], room_id)
            return
        task = asyncio.create_task(self._notify(room_id, kind, body))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def aclose(self) -> None:
        """送り中のものを flush_timeout_s だけ待ち、残りは打ち切る。"""
        if self._closed:
            return
        self._closed = True
        if not self._tasks:
            return
        _, pending = await asyncio.wait(self._tasks, timeout=self._flush_timeout_s)
        if pending:
            logger.warning("ジョブの終わりまでに送れなかった通知を捨てた: %d件", len(pending))
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

    async def _notify(self, room_id: str, kind: str, body: dict[str, Any]) -> None:
        assert self._client is not None
        try:
            result = await self._client.notify(room_id, kind, body)
        except Exception:
            logger.exception("%sの通知で予期しない失敗: %s", _LABELS[kind], room_id)
            return
        if result is NotifyResult.ROOM_GONE and self._on_room_gone is not None:
            self._on_room_gone()


def create_room_notifier(
    http: aiohttp.ClientSession,
    room_name: Callable[[], str],
    api: ApiAccess | None,
    *,
    on_room_gone: Callable[[], None] | None = None,
) -> RoomNotifier:
    """RoomNotifier を作る。api が None(設定が無い)なら何もしないものを返す。"""
    if api is None:
        return RoomNotifier(None, room_name)
    client = NotifyClient(http, api.settings, api.credentials)
    return RoomNotifier(
        client, room_name, on_room_gone=on_room_gone, min_interval_s=min_interval_from_env()
    )
