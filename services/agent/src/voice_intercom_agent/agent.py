"""ルームの中の処理。話者のトラックを購読し、発話ごとに OpenAI のセッションを開いて閉じる。

テキスト入力(データチャネルの topic "text")は text_input.py に渡す。
"""

import asyncio
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from typing import Any

import aiohttp
from livekit import rtc
from livekit.agents import JobContext

from .captions import CaptionTrack, new_segment_id
from .config import Settings
from .history import HistoryRecorder, create_api_access, create_history, utc_now
from .languages import participant_language, target_languages, wants_audio
from .notify import RoomNotifier, create_room_notifier, present_ids
from .output import CaptionPublisher, TranslationTracks
from .realtime import INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE, TranslateSession, WhisperSession
from .recording import Recorder, create_recorder
from .segmenter import Segmenter
from .speech_realtime import RealtimeSpeech
from .talk_gate import Action, TalkGate
from .text_input import TEXT_TOPIC, TextInput, parse_text_message
from .text_translation import TextTranslator

logger = logging.getLogger(__name__)

# LiveKit のルームを閉じるのを待つ上限(秒)。届かなくてもジョブは終える
ROOM_CLOSE_TIMEOUT_S = 3.0


@dataclass
class Deps:
    settings: Settings
    http: aiohttp.ClientSession
    translator: TextTranslator
    captions: CaptionPublisher
    tracks: TranslationTracks
    history: HistoryRecorder
    notifier: RoomNotifier
    recordings: Recorder
    background: set[asyncio.Task[Any]]
    # background のうち、ジョブの終わりに終わるのを待つもの(発話の書き起こしと字幕の訳)
    draining: set[asyncio.Task[Any]] = field(default_factory=set)

    def spawn(self, coro: Coroutine[Any, Any, None], *, drain: bool = False) -> asyncio.Task[None]:
        task = asyncio.create_task(coro)
        self.background.add(task)
        task.add_done_callback(self.background.discard)
        if drain:
            self.draining.add(task)
            task.add_done_callback(self.draining.discard)
        return task


class Utterance:
    """1つの発話。whisper を1本と、翻訳先の言語ごとに translate を1本開く。

    長い発話は、字幕のために途中で区切る(segmenter.py)。区切りごとに whisper の書き起こしを
    確定させ、テキスト翻訳して訳の字幕を出す。翻訳音声(translate)は区切らない。
    """

    def __init__(
        self,
        deps: Deps,
        speaker: str,
        speaker_language: str | None,
        targets: list[str],
        audio_targets: list[str] | None = None,
    ) -> None:
        """targets は訳の字幕の言語、audio_targets は翻訳の音声の言語(None なら targets と同じ)。

        翻訳の音声は、音声を聞いている人の言語にだけ作る(languages.py の wants_audio)。
        """
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
        # 区切りの番号ごとの開始時刻(履歴の occurred_at)
        self._started_at = {0: utc_now()}
        # 話者の元の音声の録音(recording.py)。設定が無ければ何もしない
        self._recording = deps.recordings.start(
            utterance_id=self.utterance_id,
            speaker_id=speaker,
            language=speaker_language,
            started_at=self._started_at[0],
        )
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
        for lang in targets if audio_targets is None else audio_targets:
            # 混ぜる入力の key は、この発話そのもの。翻訳音声(24kHz)はトラックの 48kHz に直して流す
            audio = deps.tracks.audio_input(lang, self, OUTPUT_SAMPLE_RATE)
            self._sessions.append(
                TranslateSession(
                    deps.http,
                    settings.openai_api_key,
                    model=settings.translate_model,
                    language=lang,
                    close_timeout_s=settings.translate_close_timeout_s,
                    tail_silence_s=settings.translate_tail_silence_s,
                    trim_tail=settings.translate_trim_tail,
                    on_audio=audio.push,
                    on_done=audio.close,
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
        self._recording.push(pcm)
        if self._segmenter is not None and self._segmenter.audio(pcm):
            # このフレームまでを1つの区切りとして確定させる
            self._whisper.split()
            self._open += 1
            self._started_at[self._open] = utc_now()
            logger.info("字幕を区切った: %s #%d", self.utterance_id, self._open - 1)

    def finish(self) -> None:
        for s in self._sessions:
            s.finish()
        self._recording.finish()

    def start(self) -> None:
        """セッションを動かし始める。

        書き起こしと字幕の訳は、ジョブの終わりでも待つ(履歴に残すため)。翻訳音声は待たない。
        translate の close は長いと35秒かかり、ルームを出た後では流す先も無い。
        """
        text = self._deps.spawn(self._run_text(), drain=True)
        self._deps.spawn(self._run_audio(text))

    async def _run_text(self) -> None:
        await self._whisper.run()
        # 翻訳の字幕は whisper の確定の中で始まる。終わるまで待つ
        await asyncio.gather(*self._translations)

    async def _run_audio(self, text: asyncio.Task[None]) -> None:
        await asyncio.gather(*(s.run() for s in self._sessions if s is not self._whisper))
        await text
        logger.info("発話を終えた: %s", self.utterance_id)

    def _on_delta(self, index: int, text: str) -> None:
        self._deps.captions.send(self._original(index).delta(text))
        # 区切りの判断には、いま音声を送っている区切りの書き起こしだけを使う
        if self._segmenter is not None and index == self._open:
            self._segmenter.text(text)

    def _on_transcript(self, index: int, text: str) -> None:
        self._deps.captions.send(self._original(index).final(text))
        self._deps.history.original(
            self._segment_id(index),
            text,
            sender_id=self._speaker_identity,
            language=self._speaker_language,
            occurred_at=self._started_at.get(index) or utc_now(),
            targets=self._targets,
            utterance_id=self.utterance_id,
            segment_index=index,
        )
        if not text.strip():
            return
        logger.info("原文 #%d: %s", index, text)
        for lang in self._targets:
            self._translations.append(self._deps.spawn(self._translate(index, text, lang)))

    async def _translate(self, index: int, text: str, target: str) -> None:
        track = self._caption_track(index, target, translated=True)
        parts: list[str] = []
        failed = False
        try:
            async for delta in self._deps.translator.stream(text, self._speaker_language, target):
                parts.append(delta)
                self._deps.captions.send(track.delta(delta))
        except Exception:
            logger.exception("字幕の翻訳に失敗した(%s)", target)
            failed = True
        result = "".join(parts).strip()
        self._deps.captions.send(track.final(result))
        # 失敗したときの途中までの訳は、履歴には残さない
        self._deps.history.translation(track.segment_id, target, None if failed else result)
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
            audio_targets = target_languages(
                speaker_language, listener_languages(self._room, audio_only=True)
            )
            self._utterance = Utterance(
                self._deps, identity, speaker_language, targets, audio_targets
            )
            logger.info(
                "発話を始めた: %s(%s → %s、音声 %s)%s",
                identity,
                speaker_language or "不明",
                ",".join(targets) or "なし",
                ",".join(audio_targets) or "なし",
                self._utterance.utterance_id,
            )
            self._utterance.start()
            # 話し始めの push 通知(バックグラウンドで API を呼ぶ。発話の処理は待たない)
            self._deps.notifier.started(
                identity,
                present_ids(
                    (p.identity, is_person(p)) for p in self._room.remote_participants.values()
                ),
            )
        elif action is Action.END and self._utterance is not None:
            # PTT を離したらすぐ閉じる。時間を置くと翻訳音声が捨てられる
            self._utterance.finish()
            self._utterance = None


def is_agent(participant: rtc.Participant) -> bool:
    return participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT


def is_person(participant: rtc.Participant) -> bool:
    """アプリから入った人か(Agent、Egress、SIP などを除く)。"""
    return participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD


def listener_languages(room: rtc.Room, *, audio_only: bool = False) -> list[str | None]:
    """Agent を除く参加者の言語。audio_only なら、音声を聞いている人だけ。"""
    return [
        participant_language(p.attributes)
        for p in room.remote_participants.values()
        if not is_agent(p) and (not audio_only or wants_audio(p.attributes))
    ]


async def close_job_room(ctx: JobContext) -> None:
    """LiveKit のルームを閉じて全員を切り、ジョブを終える。

    delete_room は失敗をログに残すだけで例外にしない。閉じられなくてもジョブは終える
    (録音と OpenAI の課金を止めるのが先)。ジョブの終わりの処理は IntercomAgent.aclose。
    """
    try:
        await asyncio.wait_for(ctx.delete_room(), timeout=ROOM_CLOSE_TIMEOUT_S)
    except TimeoutError:
        logger.warning("LiveKit のルームを閉じられなかった: %s", ctx.room.name)
    finally:
        ctx.shutdown("ルームがアーカイブされたか削除された")


class IntercomAgent:
    """ルームのイベントを受けて、話者ごとの Speaker を作って捨てる。

    close_room は、API がルームを使えないと答えたときに1回だけ呼ぶ(close_job_room)。
    """

    def __init__(
        self,
        room: rtc.Room,
        settings: Settings,
        translator: TextTranslator,
        *,
        close_room: Callable[[], Coroutine[Any, Any, None]] | None = None,
    ) -> None:
        self._room = room
        self._speakers: dict[str, Speaker] = {}
        self._close_room = close_room
        self._closing = False
        http = aiohttp.ClientSession()
        # API のトークンは、履歴の保存と push 通知の依頼で共有する
        api = create_api_access(http)
        self._deps = Deps(
            settings=settings,
            http=http,
            translator=translator,
            captions=CaptionPublisher(room),
            tracks=TranslationTracks(room),
            # ルーム名(API の room_id)は接続してから決まるので、保存するときに読む
            history=create_history(http, lambda: room.name, api, on_room_gone=self._room_gone),
            notifier=create_room_notifier(
                http, lambda: room.name, api, on_room_gone=self._room_gone
            ),
            recordings=create_recorder(lambda: room.name),
            background=set(),
        )
        room.on("track_subscribed", self._on_track_subscribed)
        room.on("track_unsubscribed", self._on_track_unsubscribed)
        room.on("track_muted", self._on_track_muted)
        room.on("track_unmuted", self._on_track_unmuted)
        # テキスト入力。読み上げの窓口(speech.py)の実装はここで選ぶ
        self._tts = RealtimeSpeech(
            self._deps.http,
            settings.openai_api_key,
            model=settings.tts_model,
            voice=settings.tts_voice,
            timeout_s=settings.tts_timeout_s,
            idle_close_s=settings.tts_idle_close_s,
        )
        self._text = TextInput(
            translator,
            self._tts,
            self._deps.captions,
            self._deps.tracks.speech_input,
            max_chars=settings.text_max_chars,
            history=self._deps.history,
            on_accepted=self._text_accepted,
            # 受け付け・結果と、送り直しへの字幕は、送信者だけに送る
            replies=self._deps.captions,
        )
        room.on("data_received", self._on_data_received)
        # participant_disconnected は、ルームの参加者から外した後に呼ばれる
        room.on("participant_connected", self._update_speech)
        room.on("participant_disconnected", self._update_speech)
        room.on("participant_attributes_changed", self._update_speech)

    def connected(self) -> None:
        """ルームに入った後に呼ぶ。"""
        self._update_speech()

    def _room_gone(self) -> None:
        """API がルームを使えないと答えた(404、409)。ルームを閉じてジョブを終える。

        ジョブの終わりの送り残し(aclose)で受けたときは、もう終わるので何もしない。
        """
        if self._closing:
            return
        self._closing = True
        if self._close_room is not None:
            logger.warning("ルームがもう使えないので閉じる: %s", self._room.name)
            self._deps.spawn(self._close_room())

    def _update_speech(self, *_: object) -> None:
        """音声を聞いている人の言語を読み上げに知らせる。ある言語のセッションは先に開いておき、
        人がいなくなった言語のセッションは、猶予(TTS_IDLE_CLOSE_S)の後に閉じる。"""
        languages = {lang for lang in listener_languages(self._room, audio_only=True) if lang}
        self._tts.keep_only(languages)
        if self._deps.settings.tts_prewarm:
            self._tts.prepare(languages)

    def _on_data_received(self, packet: rtc.DataPacket) -> None:
        sender = packet.participant
        if packet.topic != TEXT_TOPIC:
            return
        if sender is None:
            # 入室の直後に送られたテキストは、参加者の情報より先に届き、送信元が分からないことがある
            logger.warning("送信元が分からないテキストを捨てた(入室の直後に送られた可能性がある)")
            return
        if is_agent(sender):
            return
        message = parse_text_message(packet.data)
        if message is None:
            logger.warning("テキストを読めなかった: %s", sender.identity)
            return
        # 同じ (identity, message_id) の送り直しには、TextInput が処理をやり直さずに
        # 字幕と状態を送り直す
        # 送信者と言語は、メッセージではなく送信元の参加者から取る(なりすましを防ぐ)
        others = [
            p
            for p in self._room.remote_participants.values()
            if not is_agent(p) and p.identity != sender.identity
        ]
        listeners = [participant_language(p.attributes) for p in others]
        # 読み上げは、音声を聞いている人の言語にだけ作る
        audio_listeners = [
            participant_language(p.attributes) for p in others if wants_audio(p.attributes)
        ]
        self._deps.spawn(
            self._text.handle(
                sender.identity,
                participant_language(sender.attributes),
                listeners,
                message,
                audio_listeners,
            )
        )

    def _text_accepted(self, sender: str, text: str) -> None:
        """テキストを受け付けたら、ルームにいないメンバーへの push 通知を API に頼む(notify.py)。"""
        present = present_ids(
            (p.identity, is_person(p)) for p in self._room.remote_participants.values()
        )
        self._deps.notifier.text(sender, present, text)

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
        # 同じ sid で購読し直されたら(Python の SDK は重複を除かない)、前の発話を閉じて作り直す
        if (previous := self._speakers.pop(publication.sid, None)) is not None:
            logger.warning("同じトラックをもう一度購読した: %s", publication.sid)
            self._deps.spawn(previous.aclose())
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
        self._closing = True
        await asyncio.gather(*(s.aclose() for s in self._speakers.values()))
        self._speakers.clear()
        await self._drain_utterances()
        # 閉じかけのセッションが残っていれば、打ち切る
        for task in list(self._deps.background):
            task.cancel()
        await asyncio.gather(*self._deps.background, return_exceptions=True)
        await self._tts.aclose()
        # 打ち切った発話の分も含めて、履歴の送り残しと録音を送る。送り中の通知も同時に待つ
        await asyncio.gather(
            self._deps.history.aclose(),
            self._deps.notifier.aclose(),
            self._deps.recordings.aclose(),
        )
        await self._deps.tracks.aclose()
        await self._deps.captions.aclose()
        await self._deps.http.close()

    async def _drain_utterances(self) -> None:
        """終わった発話の書き起こしと字幕の訳を、上限まで待つ。

        最後の人が PTT を離してすぐ抜けると、commit の結果が届く前にここへ来る。打ち切ると
        whisper が空の全文で確定し、その発話は履歴に残らない。
        """
        if not self._deps.draining:
            return
        limit = self._deps.settings.shutdown_drain_s
        _, late = await asyncio.wait(self._deps.draining, timeout=limit)
        if late:
            logger.warning("ジョブの終わりまでに書き起こせなかった発話を打ち切る: %d件", len(late))
