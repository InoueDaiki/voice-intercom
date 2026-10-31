"""ルームのメンバーを外したとき・ルームを消したときの後始末。

docs/設計メモ.md の「メンバーを外したとき・ルームを消したときの後始末」。

入室の権限は LiveKit のトークンを出すとき(POST /livekit/token)にしか確かめず、接続した後の
トークンは LiveKit サーバーが更新し続ける。DB を変えただけでは、外した人は出るまで聞き・話し続け、
消したルームの履歴とメディアも残る。そこで次を行う。

- メンバーを外したら(DELETE /rooms/{room_id}/members/{user_id}。抜けたときも)、外した人が
  今ルームにいれば RoomService.RemoveParticipant で出す(evict)。LiveKit の identity は
  Cognito の sub(= user_id)なので、外した user_id と比べる。
- 所属を変えたら(PUT /users/{user_id}/tenant)、元のテナントの全ルームから同じように出す
  (evict_from_rooms。tenants.py)。出せなかったルームを返すので、呼び出し側がやり直せる。
- アーカイブしたら(POST /rooms/{room_id}/archive)、close_livekit_room で全員を切る。
- ルームを消したら(DELETE /rooms/{room_id})、rooms の行に deleting_at を書いてから、
  RoomService.DeleteRoom で全員(Agent も)を切り(close_livekit_room)、履歴とメディアを消す
  (purge)。全部終わったら rooms の行を消す(rooms.py)。
  - timeline テーブルの3つのパーティション(履歴、アップロード中の仮の行、push 通知の時刻。
    timeline_store.py)を Query して BatchWriteItem で消す。
  - S3 の rooms/<room_id>/ と仮置き(rooms/.staging/<room_id>/)の下を消す。途中のマルチパート
    アップロードも取りやめる。
  - CloudFront を `/rooms/<room_id>/*` の1パスで無効にする(ローカルでは飛ばす)。
- room_id は乱数なので(rooms.py の new_room_id)、同じ room_id で作り直すことはない。後始末を
  再開するのは DELETE のやり直しだけ。止まったら(after_delete が False)DELETE は 503 を返し、
  rooms の行が deleting_at のまま残る。この行があるので、やり直す人のテナントを確かめられる。
  行が無いルームの DELETE は 404 を返すだけで後始末をしない(テナントを確かめられないため)。
  deleting_at を入れた後のルームには、行が無ければ残りも無い。入れる前は先に行を消していたので、
  当時の途中で止まった DELETE の残りは行の無いまま残りうる。掃除は README の手順で purge を呼ぶ。

- 関数は例外を外に出さず、ログに残す。外したときの evict の失敗は HTTP の応答を失敗にしない。
  ルームを消すときと所属を変えるときは、戻り値で呼び出し側に知らせる。
  無い参加者・無いルームのエラー(not_found)は、目的は果たせているので無視する。
- 時間: LiveKit の呼び出しは1回 media_broadcast.LIVEKIT_TIMEOUT_S(2秒)で打ち切る
  (evict は ListParticipants と RemoveParticipant の2回)。purge は PURGE_BUDGET_S 秒を過ぎたら
  残りを消さずにやめる(DELETE のやり直しで続きを消す)。CloudFront は通常1秒かからない。
  evict_from_rooms は全体を EVICT_BUDGET_S 秒で打ち切る。合わせて Lambda の timeout(15秒)に収める。
- 録音のバケット(Agent が置く。管理者しか読めない)は消さない。
"""

import asyncio
import logging
import time

from livekit import api as livekit
from livekit.api.room_service import RoomService

from voice_intercom_api import media_broadcast, media_store, timeline_store

logger = logging.getLogger(__name__)

# purge に使ってよい時間(秒)。LiveKit の呼び出しと CloudFront を足しても、Lambda の
# timeout(15秒)に収まるようにする
PURGE_BUDGET_S = 6.0

# evict_from_rooms に使ってよい時間(秒)と、同時に調べるルームの数
EVICT_BUDGET_S = 8.0
_EVICT_CONCURRENCY = 10


def _is_not_found(e: BaseException) -> bool:
    return isinstance(e, livekit.ServerError) and e.code == livekit.ServerErrorCode.NOT_FOUND


async def _evict_from(
    room: RoomService, room_id: str, identities: set[str]
) -> tuple[list[str], bool]:
    """(出した人の identity, 全員を出せたか)を返す。今いない人は出せたものとする。"""
    try:
        res = await room.list_participants(livekit.ListParticipantsRequest(room=room_id))
    except livekit.ServerError as e:
        if _is_not_found(e):
            return [], True
        raise
    targets = sorted({p.identity for p in res.participants} & identities)
    results = await asyncio.gather(
        *(
            room.remove_participant(
                livekit.RoomParticipantIdentity(room=room_id, identity=identity)
            )
            for identity in targets
        ),
        return_exceptions=True,
    )
    removed: list[str] = []
    for identity, result in zip(targets, results, strict=True):
        if isinstance(result, BaseException) and not _is_not_found(result):
            logger.error(
                "外したメンバーをルームから出せなかった: room=%s identity=%s",
                room_id,
                identity,
                exc_info=result,
            )
        else:
            removed.append(identity)
    return removed, len(removed) == len(targets)


async def _evict(room_id: str, identities: set[str]) -> list[str]:
    async with media_broadcast._room_service() as room:  # pyright: ignore[reportPrivateUsage]
        removed, _ = await _evict_from(room, room_id, identities)
        return removed


def evict(room_id: str, user_ids: list[str]) -> list[str]:
    """外したメンバーのうち、今 LiveKit のルームにいる人を出す。出した人の identity を返す。"""
    if not user_ids:
        return []
    try:
        return asyncio.run(_evict(room_id, set(user_ids)))
    except Exception:
        logger.exception("外したメンバーをルームから出せなかった: room=%s", room_id)
        return []


async def _evict_from_rooms(room_ids: list[str], user_id: str, done: set[str]) -> None:
    gate = asyncio.Semaphore(_EVICT_CONCURRENCY)

    async def evict_one(room: RoomService, room_id: str) -> None:
        async with gate:
            try:
                _, ok = await _evict_from(room, room_id, {user_id})
            except Exception:
                logger.exception("ルームから出せなかった: room=%s user=%s", room_id, user_id)
                return
            if ok:
                done.add(room_id)

    async with media_broadcast._room_service() as room:  # pyright: ignore[reportPrivateUsage]
        await asyncio.gather(*(evict_one(room, room_id) for room_id in room_ids))


def evict_from_rooms(room_ids: list[str], user_id: str) -> list[str]:
    """その人をルームから出す。出したと確かめられなかったルームを返す(渡した順)。"""
    if not room_ids:
        return []
    done: set[str] = set()
    try:
        asyncio.run(
            asyncio.wait_for(_evict_from_rooms(room_ids, user_id, done), timeout=EVICT_BUDGET_S)
        )
    except Exception:
        logger.exception("ルームから出しきれなかった: user=%s", user_id)
    return [room_id for room_id in room_ids if room_id not in done]


async def _delete_room(room_id: str) -> None:
    async with media_broadcast._room_service() as room:  # pyright: ignore[reportPrivateUsage]
        try:
            await room.delete_room(livekit.DeleteRoomRequest(room=room_id))
        except livekit.ServerError as e:
            if not _is_not_found(e):
                raise


def close_livekit_room(room_id: str) -> bool:
    """LiveKit のルームを消し、全員(Agent も)を切る。ルームが無ければ何もしない。

    閉じられなかったら False。
    """
    try:
        asyncio.run(_delete_room(room_id))
    except Exception:
        logger.exception("LiveKit のルームを消せなかった: room=%s", room_id)
        return False
    return True


def purge(room_id: str, *, always_invalidate: bool) -> bool:
    """ルームの履歴(timeline)とメディア(S3)を消す。消しきれたら True。

    CloudFront の無効化は、S3 から何か消したときと、always_invalidate のとき(ルームを消したとき。
    前の purge が無効化の前で止まっていても、キャッシュを残さない)に行う。
    """
    deadline = time.monotonic() + PURGE_BUDGET_S
    prefix = media_store.room_prefix(room_id)
    try:
        rows_done = timeline_store.purge_room(room_id, deadline=deadline)
        objects_done, deleted = media_store.purge_prefix(prefix, deadline=deadline)
        staging_done, _ = media_store.purge_prefix(
            media_store.staging_room_prefix(room_id), deadline=deadline
        )
        if deleted or always_invalidate:
            media_store.invalidate(
                [f"/{prefix}*"],
                # 同じルームを何度消しても、そのたびに無効化する
                caller_reference=f"purge-{room_id}-{time.time_ns()}",
            )
    except Exception:
        logger.exception("ルームの履歴とメディアを消せなかった: room=%s", room_id)
        return False
    if not (rows_done and objects_done and staging_done):
        logger.warning(
            "ルームの履歴とメディアを時間内に消しきれなかった(DELETE のやり直しで続きを消す):"
            " room=%s",
            room_id,
        )
        return False
    return True


def after_delete(room_id: str) -> bool:
    """ルームを消すときの後始末。すべて終えたら True。False なら、やり直せば続きを行う。

    先に LiveKit から切る(Agent が履歴を書き足さないように)。切れなくても、消せる分は消す。
    """
    closed = close_livekit_room(room_id)
    purged = purge(room_id, always_invalidate=True)
    return closed and purged
