"""テキスト入力の経路。アプリが送ったテキストを、字幕と読み上げ音声でルームに届ける。

設計メモの「テキスト入力」「テキスト入力の翻訳と読み上げ」に従う。

1. アプリは TextMessage(text.proto)をデータチャネル(topic "text"、reliable)で送る。
   送信者と言語は、LiveKit の送信元の参加者(identity と属性 language)から取る。
2. 原文はすぐに Caption(確定だけ)で配信し、翻訳を待たずに読み上げを始める。
3. ルームにある言語(送信者の言語を除く)だけを、1回の呼び出しでまとめて訳す。訳がそろった
   言語から、Caption で配信して読み上げる。
4. 読み上げ音声は、言語別のトラック(translation-<言語>)に混ぜる。原文の読み上げは、送信者と
   同じ言語のトラックに流す。同じ言語の読み上げは1つずつ順に行い、重ならないようにする。
5. モデルが返す読み上げのテキストを渡した文と比べ、大きく違えばログに残す。
6. 原文と訳がそろったら、履歴に保存する(history.py。kind は "text")。

LiveKit と OpenAI には直接依存しない。翻訳・読み上げ・字幕・音声の出口は呼び出し側から渡す。
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from google.protobuf.message import DecodeError

from voiceintercom.v1.caption_pb2 import Caption
from voiceintercom.v1.text_pb2 import TextMessage

from .captions import CaptionTrack, new_segment_id
from .languages import target_languages
from .speech import TextToSpeech, speech_mismatch

logger = logging.getLogger(__name__)

# データチャネルの topic
TEXT_TOPIC = "text"


class CaptionSink(Protocol):
    def send(self, caption: Caption | None) -> None: ...


class AudioSink(Protocol):
    """1回の読み上げの音声の出口。"""

    def push(self, pcm: bytes) -> None: ...

    def close(self) -> None: ...


class HistorySink(Protocol):
    # history.py の HistoryRecorder と同じ形
    def original(
        self,
        segment_id: str,
        text: str,
        *,
        sender_id: str,
        language: str | None,
        occurred_at: datetime,
        targets: list[str],
        kind: str = ...,
    ) -> None: ...

    def translation(self, segment_id: str, language: str, text: str | None) -> None: ...


class MessageTranslator(Protocol):
    def translate_all(
        self, text: str, source: str | None, targets: list[str]
    ) -> AsyncIterator[tuple[str, str]]: ...


@dataclass(frozen=True)
class TextPlan:
    # 原文を読み上げるか。送信者と同じ言語の聞き手がいるときだけ読む
    read_original: bool
    # 翻訳先の言語
    targets: list[str] = field(default_factory=list)


def plan_text(sender_language: str | None, listeners: Iterable[str | None]) -> TextPlan:
    """原文の読み上げと翻訳先を決める。listeners は送信者と Agent を除く参加者の言語。

    送信者の言語が分からなければ、原文は読まず(流すトラックが決まらない)、聞き手の言語を
    すべて翻訳先にする。送信者自身のためには読み上げない。
    """
    langs = list(listeners)
    return TextPlan(
        read_original=sender_language is not None and sender_language in langs,
        targets=target_languages(sender_language, langs),
    )


def parse_text_message(data: bytes) -> TextMessage | None:
    try:
        return TextMessage.FromString(data)
    except DecodeError:
        return None


def clean_text(text: str, max_chars: int) -> str | None:
    """配信するテキスト。空か長すぎれば None(長いものは費用を抑えるために断る)。"""
    text = text.strip()
    if not text or len(text) > max_chars:
        return None
    return text


class TextInput:
    def __init__(
        self,
        translator: MessageTranslator,
        tts: TextToSpeech,
        captions: CaptionSink,
        open_audio: Callable[[str, int], AudioSink],
        *,
        max_chars: int,
        history: HistorySink | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._translator = translator
        self._history = history
        self._now = now
        self._tts = tts
        self._captions = captions
        # (言語, サンプルレート) から、その言語のトラックへの音声の出口を作る
        self._open_audio = open_audio
        self._max_chars = max_chars
        # 同じ言語の読み上げを1つずつ順に行うためのロック
        self._speaking: dict[str, asyncio.Lock] = {}

    async def handle(
        self,
        sender: str,
        sender_language: str | None,
        listeners: list[str | None],
        message: TextMessage,
    ) -> None:
        """1通のテキストを処理する。読み上げが全部終わるまで戻らない。

        listeners は、送信者と Agent を除く参加者の言語(受け取った時点のルーム)。
        """
        text = clean_text(message.text, self._max_chars)
        if text is None:
            logger.warning(
                "テキストを断った(空か %d文字より長い): %s %d文字",
                self._max_chars,
                sender,
                len(message.text),
            )
            return
        received_at = self._now()
        plan = plan_text(sender_language, listeners)
        segment_id = new_segment_id()

        def caption(language: str, *, translated: bool) -> CaptionTrack:
            return CaptionTrack(
                speaker_identity=sender,
                segment_id=segment_id,
                language=language,
                translated=translated,
                message_id=message.message_id,
            )

        self._captions.send(caption(sender_language or "", translated=False).final(text))
        if self._history is not None:
            # 履歴の source_id は segment_id(Agent が振る)。アプリが振る message_id は重なりうる
            self._history.original(
                segment_id,
                text,
                sender_id=sender,
                language=sender_language,
                occurred_at=received_at,
                targets=list(plan.targets),
                kind="text",
            )
        logger.info(
            "テキストを受け取った: %s(%s → %s)%s: %s",
            sender,
            sender_language or "不明",
            ",".join(plan.targets) or "なし",
            message.message_id,
            text,
        )
        speeches: list[asyncio.Task[None]] = []
        if plan.read_original and sender_language is not None:
            # 原文の読み上げは、翻訳を待たずに始める
            speeches.append(asyncio.create_task(self._speak(text, sender_language)))
        if plan.targets:
            done: set[str] = set()
            try:
                async for lang, translated in self._translator.translate_all(
                    text, sender_language, plan.targets
                ):
                    done.add(lang)
                    translated = translated.strip()
                    self._captions.send(caption(lang, translated=True).final(translated))
                    if self._history is not None:
                        self._history.translation(segment_id, lang, translated)
                    logger.info("テキストの訳(%s): %s", lang, translated)
                    if translated:
                        speeches.append(asyncio.create_task(self._speak(translated, lang)))
            except Exception:
                logger.exception("テキストの翻訳に失敗した")
            if missing := [lang for lang in plan.targets if lang not in done]:
                logger.warning("訳がそろわなかった言語: %s", ",".join(missing))
                if self._history is not None:
                    for lang in missing:
                        self._history.translation(segment_id, lang, None)
        await asyncio.gather(*speeches)

    async def _speak(self, text: str, language: str) -> None:
        lock = self._speaking.setdefault(language, asyncio.Lock())
        async with lock:
            sink = self._open_audio(language, self._tts.sample_rate)
            try:
                result = await self._tts.speak(text, language, sink.push)
            except Exception:
                logger.exception("読み上げに失敗した(%s)", language)
                return
            finally:
                sink.close()
        score = speech_mismatch(text, result.transcript)
        if score is not None:
            logger.warning(
                "読み上げのテキストが渡した文と違う(%s、近さ %.2f): 文「%s」 読み上げ「%s」",
                language,
                score,
                text,
                result.transcript,
            )
