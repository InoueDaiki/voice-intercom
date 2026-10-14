"""ルームへの出力。言語別の翻訳音声トラックと、データチャネルの字幕。

言語別のトラック(translation-<言語>)には、音声の翻訳音声と、テキスト入力の読み上げ
(その言語への訳と、その言語で書かれた原文)を混ぜる。トラックは 48kHz で、翻訳音声(24kHz)も
読み上げ(24kHz)も、リサンプルしてから混ぜる。
"""

import asyncio
import logging

from livekit import rtc

from voiceintercom.v1.caption_pb2 import Caption
from voiceintercom.v1.text_status_pb2 import TextStatus

from .captions import CAPTION_TOPIC
from .mixer import Mixer
from .text_input import TEXT_STATUS_TOPIC

logger = logging.getLogger(__name__)

# トラックのサンプルレート。WebRTC(Opus)の 48kHz に合わせる
TRACK_SAMPLE_RATE = 48000
# 100ms ずつ混ぜて流す
CHUNK_SAMPLES = TRACK_SAMPLE_RATE // 10

# テキスト入力の読み上げを混ぜるときの入力の key。同じ言語の読み上げは同じ key にして、
# 続けて読み上げた文が重ならずに順に流れるようにする(mixer.py)
_SPEECH_KEY = object()


def translation_track_name(language: str) -> str:
    """聞き手は、この名前で自分の言語のトラックを選んで購読する。"""
    return f"translation-{language}"


class TranslationTrack:
    """1つの言語の翻訳音声のトラック。同時に話している話者の翻訳音声を混ぜて流す。"""

    def __init__(self, room: rtc.Room, language: str) -> None:
        self.language = language
        self._room = room
        self._source = rtc.AudioSource(TRACK_SAMPLE_RATE, 1)
        self._mixer = Mixer(CHUNK_SAMPLES)
        self._wake = asyncio.Event()
        self._task = asyncio.create_task(self._run())

    def push(self, key: object, pcm: bytes) -> None:
        """key は入力(話者の発話)ごとに別のもの。pcm は TRACK_SAMPLE_RATE の PCM16・モノラル。"""
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
            frame = rtc.AudioFrame(pcm, TRACK_SAMPLE_RATE, 1, CHUNK_SAMPLES)
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

    def audio_input(self, language: str, key: object, sample_rate: int) -> AudioInput:
        """その言語のトラックに流す入力。key は混ぜる入力の区別(話者の発話ごとに別のもの)。"""
        return AudioInput(self.get(language), key, sample_rate)

    def speech_input(self, language: str, sample_rate: int) -> AudioInput:
        """テキスト入力の読み上げ音声を、その言語のトラックに流す入力。1回の読み上げごとに作る。"""
        return self.audio_input(language, _SPEECH_KEY, sample_rate)

    async def aclose(self) -> None:
        await asyncio.gather(*(t.aclose() for t in self._tracks.values()))


class AudioInput:
    """音声(PCM16・モノラル)を、トラックのサンプルレートに直して流す。"""

    def __init__(self, track: TranslationTrack, key: object, sample_rate: int) -> None:
        self._track = track
        self._key = key
        self._resampler = (
            rtc.AudioResampler(sample_rate, TRACK_SAMPLE_RATE)
            if sample_rate != TRACK_SAMPLE_RATE
            else None
        )

    def push(self, pcm: bytes) -> None:
        if self._resampler is None:
            self._track.push(self._key, pcm)
            return
        for frame in self._resampler.push(bytearray(pcm)):
            self._track.push(self._key, frame.data.tobytes())

    def close(self) -> None:
        if self._resampler is not None:
            for frame in self._resampler.flush():
                self._track.push(self._key, frame.data.tobytes())
        self._track.close(self._key)


class CaptionPublisher:
    """字幕をデータチャネルで送る。送る順番を保つため、1つのタスクから順に送る。

    テキスト入力の送信者だけに宛てるもの(送り直しへの字幕と、受け付け・結果の TextStatus)も、
    同じ順番で送る(destination_identities)。
    """

    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        # (中身, topic, 宛先)。宛先が空ならルームの全員
        self._queue: asyncio.Queue[tuple[bytes, str, list[str]]] = asyncio.Queue()
        self._task = asyncio.create_task(self._run())

    def send(self, caption: Caption | None) -> None:
        if caption is not None:
            self._queue.put_nowait((caption.SerializeToString(), CAPTION_TOPIC, []))

    def send_to(self, identity: str, caption: Caption) -> None:
        """字幕を1人にだけ送る(送り直されたテキストの字幕)。"""
        self._queue.put_nowait((caption.SerializeToString(), CAPTION_TOPIC, [identity]))

    def send_status(self, identity: str, status: TextStatus) -> None:
        """テキスト入力の受け付け・結果を、送信者にだけ送る。"""
        self._queue.put_nowait((status.SerializeToString(), TEXT_STATUS_TOPIC, [identity]))

    async def _run(self) -> None:
        while True:
            data, topic, destinations = await self._queue.get()
            try:
                await self._room.local_participant.publish_data(
                    data, reliable=True, topic=topic, destination_identities=destinations
                )
            except Exception:
                logger.exception("データを送れなかった(%s)", topic)

    async def aclose(self) -> None:
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
