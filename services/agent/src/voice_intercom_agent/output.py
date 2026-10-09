"""ルームへの出力。言語別の翻訳音声トラックと、データチャネルの字幕。"""

import asyncio
import logging

from livekit import rtc

from voiceintercom.v1.caption_pb2 import Caption

from .captions import CAPTION_TOPIC
from .mixer import Mixer
from .realtime import OUTPUT_SAMPLE_RATE

logger = logging.getLogger(__name__)

# 100ms ずつ混ぜて流す
CHUNK_SAMPLES = OUTPUT_SAMPLE_RATE // 10


def translation_track_name(language: str) -> str:
    """聞き手は、この名前で自分の言語のトラックを選んで購読する。"""
    return f"translation-{language}"


class TranslationTrack:
    """1つの言語の翻訳音声のトラック。同時に話している話者の翻訳音声を混ぜて流す。"""

    def __init__(self, room: rtc.Room, language: str) -> None:
        self.language = language
        self._room = room
        self._source = rtc.AudioSource(OUTPUT_SAMPLE_RATE, 1)
        self._mixer = Mixer(CHUNK_SAMPLES)
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    def push(self, key: object, pcm: bytes) -> None:
        """key は入力(話者の発話)ごとに別のものを渡す。"""
        self._mixer.push(key, pcm)
        self._wake.set()

    def close(self, key: object) -> None:
        self._mixer.close(key)
        self._wake.set()

    async def _run(self) -> None:
        name = translation_track_name(self.language)
        track = rtc.LocalAudioTrack.create_audio_track(name, self._source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await self._room.local_participant.publish_track(track, options)
        logger.info("翻訳音声のトラックを公開した: %s", name)
        while True:
            pcm = self._mixer.pop()
            if pcm is None:
                self._wake.clear()
                await self._wake.wait()
                continue
            # capture_frame は送信のキューが詰まると待つので、届くのが早くても実時間で流れる
            frame = rtc.AudioFrame(pcm, OUTPUT_SAMPLE_RATE, 1, CHUNK_SAMPLES)
            await self._source.capture_frame(frame)

    async def aclose(self) -> None:
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
        await self._source.aclose()


class TranslationTracks:
    """言語別のトラック。初めて使う言語のトラックを、そのときに公開する。"""

    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        self._tracks: dict[str, TranslationTrack] = {}

    def get(self, language: str) -> TranslationTrack:
        track = self._tracks.get(language)
        if track is None:
            track = self._tracks[language] = TranslationTrack(self._room, language)
        return track

    async def aclose(self) -> None:
        await asyncio.gather(*(t.aclose() for t in self._tracks.values()))


class CaptionPublisher:
    """字幕をデータチャネルで送る。送る順番を保つため、1つのタスクから順に送る。"""

    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        self._queue: asyncio.Queue[Caption] = asyncio.Queue()
        self._task = asyncio.create_task(self._run())

    def send(self, caption: Caption | None) -> None:
        if caption is not None:
            self._queue.put_nowait(caption)

    async def _run(self) -> None:
        while True:
            caption = await self._queue.get()
            try:
                await self._room.local_participant.publish_data(
                    caption.SerializeToString(), reliable=True, topic=CAPTION_TOPIC
                )
            except Exception:
                logger.exception("字幕を送れなかった")

    async def aclose(self) -> None:
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
