"""ルームのメンバーを外したとき・ルームを消したときの後始末。

docs/設計メモ.md の「メンバーを外したとき・ルームを消したときの後始末」。

入室の権限は LiveKit のトークンを出すとき(POST /livekit/token)にしか確かめず、接続した後の
トークンは LiveKit サーバーが更新し続ける。DB を変えただけでは、外した人は出るまで聞き・話し続け、
同じ room_id で作り直したルームには前のルームの履歴とメディアが見える。そこで次を行う。

- メンバーを外したら(PATCH /rooms/{room_id})、外した人のうち今ルームにいる人を
  RoomService.RemoveParticipant で出す(evict)。LiveKit の identity は Cognito の sub
  (= user_id)なので、外した user_id と比べる。管理者はメンバーでなくても入れるが、LiveKit の
  identity からは管理者か分からないので、メンバーから外した管理者も出す(入り直せばよい)。
- ルームを消したら(DELETE /rooms/{room_id})、RoomService.DeleteRoom で全員(Agent も)を
  切り(close_livekit_room)、履歴とメディアを消す(purge)。
  - timeline テーブルの3つのパーティション(履歴、アップロード中の仮の行、push 通知の時刻。
    timeline_store.py)を Query して BatchWriteItem で消す。
  - S3 の rooms/<room_id>/ の下を消す。途中のマルチパートアップロードも取りやめる。
  - CloudFront を `/rooms/<room_id>/*` の1パスで無効にする(ローカルでは飛ばす)。
- ルームを作るときにも purge する(POST /rooms)。前のルームの purge が途中で終わったり
  失敗したりしても、作り直すときに残りが消える(メンバーの行と同じ考え方。store.py)。
  消すものが無ければ、Query 3回と List 2回で終わる。無いルームの DELETE(404)でも
  after_delete を行うので、管理者が DELETE をやり直しても残りが消える。

- どれが失敗しても例外は外に出さず、ログに残す(HTTP の応答は失敗にしない)。
  無い参加者・無いルームのエラー(not_found)は、目的は果たせているので無視する。
- 時間: LiveKit の呼び出しは1回 media_broadcast.LIVEKIT_TIMEOUT_S(2秒)で打ち切る
  (evict は ListParticipants と RemoveParticipant の2回)。purge は PURGE_BUDGET_S 秒を過ぎたら
  残りを消さずにやめる(次に同じ room_id で作るときに続きを消す)。CloudFront は通常1秒かからない。
  合わせて Lambda の timeout(15秒)に収める。
- 録音のバケット(Agent が置く。管理者しか読めない)は消さない。
"""

import asyncio
import logging
import time

from livekit import api as livekit

from voice_intercom_api import media_broadcast, media_store, timeline_store

logger = logging.getLogger(__name__)

# purge に使ってよい時間(秒)。LiveKit の呼び出しと CloudFront を足しても、Lambda の
# timeout(15秒)に収まるようにする
PURGE_BUDGET_S = 6.0


def _is_not_found(e: BaseException) -> bool:
    return isinstance(e, livekit.ServerError) and e.code == livekit.ServerErrorCode.NOT_FOUND


async def _evict(room_id: str, identities: set[str]) -> list[str]:
    async with media_broadcast._room_service() as room:  # pyright: ignore[reportPrivateUsage]
        try:
            res = await room.list_participants(livekit.ListParticipantsRequest(room=room_id))
        except livekit.ServerError as e:
            if _is_not_found(e):
                return []
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


async def _delete_room(room_id: str) -> None:
    async with media_broadcast._room_service() as room:  # pyright: ignore[reportPrivateUsage]
        try:
            await room.delete_room(livekit.DeleteRoomRequest(room=room_id))
        except livekit.ServerError as e:
            if not _is_not_found(e):
                raise


def close_livekit_room(room_id: str) -> None:
    """LiveKit のルームを消し、全員(Agent も)を切る。ルームが無ければ何もしない。"""
    try:
        asyncio.run(_delete_room(room_id))
    except Exception:
        logger.exception("LiveKit のルームを消せなかった: room=%s", room_id)


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
        if deleted or always_invalidate:
            media_store.invalidate(
                [f"/{prefix}*"],
                # 同じルームを何度消しても、そのたびに無効化する
                caller_reference=f"purge-{room_id}-{time.time_ns()}",
            )
    except Exception:
        logger.exception("ルームの履歴とメディアを消せなかった: room=%s", room_id)
        return False
    if not (rows_done and objects_done):
        logger.warning(
            "ルームの履歴とメディアを時間内に消しきれなかった(同じ room_id で作るときに続きを消す):"
            " room=%s",
            room_id,
        )
        return False
    return True


def after_delete(room_id: str) -> None:
    """ルームを消した後の後始末。先に LiveKit から切る(Agent が履歴を書き足さないように)。"""
    close_livekit_room(room_id)
    purge(room_id, always_invalidate=True)
