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
7. アプリは、自分の message_id の字幕が返ってこなければ同じ message_id で送り直す(入室の直後は
   送信元が分からず捨てることがあるため)。同じ (送信者, message_id) は1回だけ処理する。
   送り直されたら、翻訳や読み上げはやり直さず、それまでに配信した字幕と状態を送信者だけに
   送り直す(最初の字幕を送信者のアプリが捨てていても、送り直しが止まるように)。
8. 受け付け・断り・結果(TextStatus。text_status.proto)を、送信者だけに宛てて送る。

LiveKit と OpenAI には直接依存しない。翻訳・読み上げ・字幕・音声の出口は呼び出し側から渡す。
"""

import asyncio
import logging
import time
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from google.protobuf.message import DecodeError

from voiceintercom.v1.caption_pb2 import Caption
from voiceintercom.v1.text_pb2 import TextMessage
from voiceintercom.v1.text_status_pb2 import TextStatus

from .captions import CaptionTrack, new_segment_id
from .languages import target_languages
from .speech import TextToSpeech, speech_mismatch

logger = logging.getLogger(__name__)

# データチャネルの topic
TEXT_TOPIC = "text"
# 受け付けと結果(TextStatus)の topic。送信者だけに宛てる
TEXT_STATUS_TOPIC = "text_status"


class CaptionSink(Protocol):
    def send(self, caption: Caption | None) -> None: ...


class ReplySink(Protocol):
    """送信者だけに宛てて送る出口(データチャネルの destination_identities)。"""

    def send_to(self, identity: str, caption: Caption) -> None: ...

    def send_status(self, identity: str, status: TextStatus) -> None: ...


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


def rejection(text: str) -> TextStatus.Reason:
    """clean_text が断ったテキストの理由。"""
    return TextStatus.REASON_EMPTY if not text.strip() else TextStatus.REASON_TOO_LONG


@dataclass
class TextRecord:
    """処理した1通の記録。送り直されたときに、字幕と状態を送り直すために持つ。"""

    # 配信した字幕(原文と訳の確定)。処理中なら、そこまでの分
    captions: list[Caption] = field(default_factory=list)
    # 最後に送った状態。message_id が空なら送らないので None のまま
    status: TextStatus | None = None


class RecentMessages[T]:
    """最近処理した (送信者, message_id) と、その記録。アプリの送り直しを1回だけ処理するために使う。

    送り直しは数秒のうちに届くので、ttl_s より古いものと、max_size を超えた古いものは忘れる。
    message_id が空のものは見分けられないので、覚えない。
    """

    def __init__(
        self,
        *,
        ttl_s: float = 600.0,
        max_size: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_s = ttl_s
        self._max_size = max_size
        self._clock = clock
        self._seen: OrderedDict[tuple[str, str], tuple[float, T]] = OrderedDict()

    def get(self, sender: str, message_id: str) -> T | None:
        """既に処理したものなら、その記録。初めてなら None。"""
        if not message_id:
            return None
        self._expire()
        entry = self._seen.get((sender, message_id))
        return entry[1] if entry is not None else None

    def add(self, sender: str, message_id: str, value: T) -> None:
        if not message_id:
            return
        self._expire()
        key = (sender, message_id)
        self._seen.pop(key, None)
        if len(self._seen) >= self._max_size:
            self._seen.popitem(last=False)
        self._seen[key] = (self._clock(), value)

    def _expire(self) -> None:
        now = self._clock()
        while self._seen and now - next(iter(self._seen.values()))[0] >= self._ttl_s:
            self._seen.popitem(last=False)


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
        on_accepted: Callable[[str, str], None] | None = None,
        replies: ReplySink | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        # 受け付けたテキストの (送信者, 本文) を知らせる先(push 通知。notify.py)
        self._on_accepted = on_accepted
        self._translator = translator
        self._history = history
        self._replies = replies
        # 処理した (送信者, message_id) の記録。送り直しに字幕と状態を送り直す
        self._recent: RecentMessages[TextRecord] = RecentMessages()
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
        同じ (送信者, message_id) が送り直されたら、処理はやり直さず、字幕と状態を送り直す。
        """
        mid = message.message_id
        if (seen := self._recent.get(sender, mid)) is not None:
            self._resend(sender, mid, seen)
            return
        record = TextRecord()
        self._recent.add(sender, mid, record)
        text = clean_text(message.text, self._max_chars)
        if text is None:
            logger.warning(
                "テキストを断った(空か %d文字より長い): %s %d文字",
                self._max_chars,
                sender,
                len(message.text),
            )
            reason = rejection(message.text)
            self._status(
                sender,
                record,
                TextStatus(
                    message_id=mid,
                    state=TextStatus.STATE_REJECTED,
                    reason=reason,
                    max_chars=self._max_chars if reason == TextStatus.REASON_TOO_LONG else 0,
                ),
            )
            return
        self._status(sender, record, TextStatus(message_id=mid, state=TextStatus.STATE_ACCEPTED))
        if self._on_accepted is not None:
            self._on_accepted(sender, text)
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

        self._caption(record, caption(sender_language or "", translated=False).final(text))
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
        # (言語, 読み上げ)。読み上げは成功したら True を返す
        speeches: list[tuple[str, asyncio.Task[bool]]] = []
        missing: list[str] = []
        if plan.read_original and sender_language is not None:
            # 原文の読み上げは、翻訳を待たずに始める
            speeches.append(
                (sender_language, asyncio.create_task(self._speak(text, sender_language)))
            )
        if plan.targets:
            done: set[str] = set()
            try:
                async for lang, translated in self._translator.translate_all(
                    text, sender_language, plan.targets
                ):
                    done.add(lang)
                    translated = translated.strip()
                    self._caption(record, caption(lang, translated=True).final(translated))
                    if self._history is not None:
                        self._history.translation(segment_id, lang, translated)
                    logger.info("テキストの訳(%s): %s", lang, translated)
                    if translated:
                        speeches.append((lang, asyncio.create_task(self._speak(translated, lang))))
            except Exception:
                logger.exception("テキストの翻訳に失敗した")
            if missing := [lang for lang in plan.targets if lang not in done]:
                logger.warning("訳がそろわなかった言語: %s", ",".join(missing))
                if self._history is not None:
                    for lang in missing:
                        self._history.translation(segment_id, lang, None)
        spoken = await asyncio.gather(*(task for _, task in speeches))
        unspoken = [lang for (lang, _), ok in zip(speeches, spoken, strict=True) if not ok]
        if missing or unspoken:
            final = TextStatus(
                message_id=mid,
                state=TextStatus.STATE_FAILED,
                untranslated_languages=missing,
                unspoken_languages=unspoken,
            )
        else:
            final = TextStatus(message_id=mid, state=TextStatus.STATE_COMPLETED)
        self._status(sender, record, final)

    def _caption(self, record: TextRecord, caption: Caption | None) -> None:
        if caption is not None:
            record.captions.append(caption)
        self._captions.send(caption)

    def _status(self, sender: str, record: TextRecord, status: TextStatus) -> None:
        if not status.message_id:
            # アプリが結び付けられないので送らない
            return
        record.status = status
        if self._replies is not None:
            self._replies.send_status(sender, status)

    def _resend(self, sender: str, message_id: str, record: TextRecord) -> None:
        """送り直されたテキストに、配信した字幕と状態を送信者だけに送り直す。

        最初の字幕を送信者のアプリが捨てていても(Agent を知る前に届いた字幕は捨てる)、これで
        送り直しが止まる。処理中なら、そこまでの字幕と ACCEPTED を送る(残りの字幕は、そろったときに
        ルームに配信し、結果も送る)。
        """
        logger.info(
            "送り直されたテキストに、字幕 %d個と状態を送り直した: %s %s",
            len(record.captions),
            sender,
            message_id,
        )
        if self._replies is None:
            return
        for caption in record.captions:
            self._replies.send_to(sender, caption)
        if record.status is not None:
            self._replies.send_status(sender, record.status)

    async def _speak(self, text: str, language: str) -> bool:
        lock = self._speaking.setdefault(language, asyncio.Lock())
        async with lock:
            sink = self._open_audio(language, self._tts.sample_rate)
            try:
                result = await self._tts.speak(text, language, sink.push)
            except Exception:
                logger.exception("読み上げに失敗した(%s)", language)
                return False
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
        return True
