"""LiveKit の参加者の属性 audio(音声をつないでいるか)。

docs/設計メモ.md の「ユーザーの3つの状態の表し方」。ルームの画面を開いている間はデータだけで
つなぎ、音声をつないでいる間だけ audio を on にする。Agent は、翻訳の音声と読み上げを audio が
on の人の言語にだけ作る(services/agent の README の「ルームとの取り決め」)。

入るときはトークンの属性に入れ(app.py の POST /livekit/token)、つないだまま切り替えるときは
ここで RoomService.UpdateParticipant を呼ぶ。参加者に自分の属性を変える権限
(canUpdateOwnMetadata)を渡すと、表示名や言語まで変えられてしまうので渡さない。
"""

import asyncio

from livekit import api as livekit

from voice_intercom_api import media_broadcast

# 参加者の属性のキーと値。services/agent の languages.py の AUDIO_ATTRIBUTE と揃える
AUDIO_ATTRIBUTE = "audio"
AUDIO_ON = "on"
AUDIO_OFF = "off"


def audio_value(enabled: bool) -> str:
    return AUDIO_ON if enabled else AUDIO_OFF


class NotInRoomError(Exception):
    """その人が LiveKit のルームにいない。"""


async def _set_audio(room_id: str, identity: str, enabled: bool) -> None:
    async with media_broadcast._room_service() as room:  # pyright: ignore[reportPrivateUsage]
        try:
            # 属性は渡したキーだけが変わる(language はそのまま)
            await room.update_participant(
                livekit.UpdateParticipantRequest(
                    room=room_id,
                    identity=identity,
                    attributes={AUDIO_ATTRIBUTE: audio_value(enabled)},
                )
            )
        except livekit.ServerError as e:
            if e.code == livekit.ServerErrorCode.NOT_FOUND:
                raise NotInRoomError(identity) from e
            raise


def set_audio(room_id: str, identity: str, enabled: bool) -> None:
    """参加者の audio を変える。ルームにいなければ NotInRoomError。

    LiveKit の呼び出しは media_broadcast.LIVEKIT_TIMEOUT_S(2秒)で打ち切る。
    """
    asyncio.run(_set_audio(room_id, identity, enabled))
