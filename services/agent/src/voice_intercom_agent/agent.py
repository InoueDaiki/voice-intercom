"""ルームの中の処理。話者のトラックを購読し、発話ごとに OpenAI のセッションを開いて閉じる。"""

import asyncio
import functools
import logging
from collections.abc import Coroutine
from dataclasses import dataclass
from typing import Any

import aiohttp
from livekit import rtc

from .captions import CaptionTrack, new_segment_id
from .config import Settings
from .languages import participant_language, target_languages
from .output import CaptionPublisher, TranslationTracks
from .realtime import INPUT_SAMPLE_RATE, TranslateSession, WhisperSession
from .segmenter import Segmenter
from .talk_gate import Action, TalkGate
from .text_translation import TextTranslator

logger = logging.getLogger(__name__)


@dataclass
class Deps:
    settings: Settings
    http: aiohttp.ClientSession
    translator: TextTranslator
    captions: CaptionPublisher
    tracks: TranslationTracks
    background: set[asyncio.Task[Any]]

    def spawn(self, coro: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(coro)
        self.background.add(task)
        task.add_done_callback(self.background.discard)


class Utterance:
    """1つの発話。whisper を1本と、翻訳先の言語ごとに translate を1本開く。

    長い発話は、字幕のために途中で区切る(segmenter.py)。区切りごとに whisper の書き起こしを
    確定させ、テキスト翻訳して訳の字幕を出す。翻訳音声(translate)は区切らない。
    """

    def __init__(
        self, deps: Deps, speaker: str, speaker_language: str | None, targets: list[str]
    ) -> None:
        self._deps = deps
        self._speaker_identity = speaker
        self._speaker_language = speaker_language
        self._targets = targets
        self.utterance_id = new_segment_id()
        settings = deps.settings
        rules = settings.segment_rules
        self._segmenter = Segmenter(rules) if rules is not None else None
        # 区切りの番号ごとの segment_id と原文の字幕。いま音声を送っている区切りの番号
        self._segment_ids: dict[int, str] = {}
        self._originals: dict[int, CaptionTrack] = {}
        self._open = 0
        self._translations: list[asyncio.Task[None]] = []
        self._whisper = WhisperSession(
            deps.http,
            settings.openai_api_key,
            model=settings.whisper_model,
            language=speaker_language,
            commit_timeout_s=settings.whisper_commit_timeout_s,
            on_delta=self._on_delta,
            on_completed=self._on_transcript,
        )
        self._sessions: list[WhisperSession | TranslateSession] = [self._whisper]
        for lang in targets:
            track = deps.tracks.get(lang)
            self._sessions.append(
                TranslateSession(
                    deps.http,
                    settings.openai_api_key,
                    model=settings.translate_model,
                    language=lang,
                    close_timeout_s=settings.translate_close_timeout_s,
                    # 混ぜる入力の key は、この発話そのもの
                    on_audio=functools.partial(track.push, self),
                    on_done=functools.partial(track.close, self),
                )
            )

    def _segment_id(self, index: int) -> str:
        segment_id = self._segment_ids.get(index)
        if segment_id is None:
            segment_id = self._segment_ids[index] = new_segment_id()
        return segment_id

    def _original(self, index: int) -> CaptionTrack:
        track = self._originals.get(index)
        if track is None:
            track = self._originals[index] = self._caption_track(
                index, self._speaker_language or "", translated=False
            )
        return track

    def _caption_track(self, index: int, language: str, *, translated: bool) -> CaptionTrack:
        return CaptionTrack(
            speaker_identity=self._speaker_identity,
            segment_id=self._segment_id(index),
            language=language,
            translated=translated,
            utterance_id=self.utterance_id,
            segment_index=index,
        )

    def push(self, pcm: bytes) -> None:
        for s in self._sessions:
            s.push(pcm)
        if self._segmenter is not None and self._segmenter.audio(pcm):
            # このフレームまでを1つの区切りとして確定させる
            self._whisper.split()
            self._open += 1
            logger.info("字幕を区切った: %s #%d", self.utterance_id, self._open - 1)

    def finish(self) -> None:
        for s in self._sessions:
            s.finish()

    async def run(self) -> None:
        await asyncio.gather(*(s.run() for s in self._sessions))
        # 翻訳の字幕は whisper の確定の中で始まる。終わるまで待つ
        await asyncio.gather(*self._translations)
        logger.info("発話を終えた: %s", self.utterance_id)

    def _on_delta(self, index: int, text: str) -> None:
        self._deps.captions.send(self._original(index).delta(text))
        # 区切りの判断には、いま音声を送っている区切りの書き起こしだけを使う
        if self._segmenter is not None and index == self._open:
            self._segmenter.text(text)

    def _on_transcript(self, index: int, text: str) -> None:
        self._deps.captions.send(self._original(index).final(text))
        if not text.strip():
            return
        logger.info("原文 #%d: %s", index, text)
        for lang in self._targets:
            self._translations.append(asyncio.create_task(self._translate(index, text, lang)))

    async def _translate(self, index: int, text: str, target: str) -> None:
        track = self._caption_track(index, target, translated=True)
        parts: list[str] = []
        try:
            async for delta in self._deps.translator.stream(text, self._speaker_language, target):
                parts.append(delta)
                self._deps.captions.send(track.delta(delta))
        except Exception:
            logger.exception("字幕の翻訳に失敗した(%s)", target)
        result = "".join(parts).strip()
        self._deps.captions.send(track.final(result))
        logger.info("訳 #%d(%s): %s", index, target, result)


class Speaker:
    """話者の音声トラック1本。ミュートが外れている間だけ、発話に音声を渡す。"""

    def __init__(
        self, deps: Deps, room: rtc.Room, participant: rtc.RemoteParticipant, track: rtc.Track
    ) -> None:
        self._deps = deps
        self._room = room
        self._participant = participant
        self._gate = TalkGate()
        self._utterance: Utterance | None = None
        # LiveKit の 48kHz から 24kHz へのリサンプリングは AudioStream がする
        self._stream = rtc.AudioStream.from_track(
            track=track, sample_rate=INPUT_SAMPLE_RATE, num_channels=1
        )
        self._task = asyncio.create_task(self._pump())

    def subscribed(self, *, muted: bool) -> None:
        self._apply(self._gate.subscribed(muted=muted))

    def muted(self) -> None:
        self._apply(self._gate.muted())

    def unmuted(self) -> None:
        self._apply(self._gate.unmuted())

    async def aclose(self) -> None:
        self._apply(self._gate.unsubscribed())
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
        await self._stream.aclose()

    async def _pump(self) -> None:
        async for ev in self._stream:
            if self._utterance is not None and self._gate.is_open:
                self._utterance.push(ev.frame.data.tobytes())

    def _apply(self, action: Action | None) -> None:
        if action is Action.START:
            identity = self._participant.identity
            speaker_language = participant_language(self._participant.attributes)
            targets = target_languages(speaker_language, listener_languages(self._room))
            self._utterance = Utterance(self._deps, identity, speaker_language, targets)
            logger.info(
                "発話を始めた: %s(%s → %s)%s",
                identity,
                speaker_language or "不明",
                ",".join(targets) or "なし",
                self._utterance.utterance_id,
            )
            self._deps.spawn(self._utterance.run())
        elif action is Action.END and self._utterance is not None:
            # PTT を離したらすぐ閉じる。時間を置くと翻訳音声が捨てられる
            self._utterance.finish()
            self._utterance = None


def is_agent(participant: rtc.Participant) -> bool:
    return participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT


def listener_languages(room: rtc.Room) -> list[str | None]:
    return [
        participant_language(p.attributes)
        for p in room.remote_participants.values()
        if not is_agent(p)
    ]


class IntercomAgent:
    """ルームのイベントを受けて、話者ごとの Speaker を作って捨てる。"""

    def __init__(self, room: rtc.Room, settings: Settings, translator: TextTranslator) -> None:
        self._room = room
        self._speakers: dict[str, Speaker] = {}
        self._deps = Deps(
            settings=settings,
            http=aiohttp.ClientSession(),
            translator=translator,
            captions=CaptionPublisher(room),
            tracks=TranslationTracks(room),
            background=set(),
        )
        room.on("track_subscribed", self._on_track_subscribed)
        room.on("track_unsubscribed", self._on_track_unsubscribed)
        room.on("track_muted", self._on_track_muted)
        room.on("track_unmuted", self._on_track_unmuted)

    def _on_track_subscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        if (
            track.kind != rtc.TrackKind.KIND_AUDIO
            or publication.source != rtc.TrackSource.SOURCE_MICROPHONE
            or is_agent(participant)
        ):
            return
        speaker = Speaker(self._deps, self._room, participant, track)
        self._speakers[publication.sid] = speaker
        speaker.subscribed(muted=publication.muted)

    def _on_track_unsubscribed(
        self,
        track: rtc.Track,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ) -> None:
        speaker = self._speakers.pop(publication.sid, None)
        if speaker is not None:
            self._deps.spawn(speaker.aclose())

    def _on_track_muted(self, participant: rtc.Participant, publication: rtc.TrackPublication):
        if speaker := self._speakers.get(publication.sid):
            speaker.muted()

    def _on_track_unmuted(self, participant: rtc.Participant, publication: rtc.TrackPublication):
        if speaker := self._speakers.get(publication.sid):
            speaker.unmuted()

    async def aclose(self) -> None:
        await asyncio.gather(*(s.aclose() for s in self._speakers.values()))
        self._speakers.clear()
        # 閉じかけのセッションが残っていれば、打ち切る
        for task in list(self._deps.background):
            task.cancel()
        await asyncio.gather(*self._deps.background, return_exceptions=True)
        await self._deps.tracks.aclose()
        await self._deps.captions.aclose()
        await self._deps.http.close()
