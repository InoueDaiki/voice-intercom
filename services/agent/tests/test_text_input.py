import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Iterable
from datetime import UTC, datetime
from typing import Any

import pytest

from voice_intercom_agent.speech import SpeechResult
from voice_intercom_agent.text_input import (
    RecentMessages,
    TextInput,
    TextPlan,
    clean_text,
    parse_text_message,
    plan_text,
)
from voice_intercom_agent.text_translation import message_input, translations_schema
from voiceintercom.v1.caption_pb2 import Caption
from voiceintercom.v1.text_pb2 import TextMessage
from voiceintercom.v1.text_status_pb2 import TextStatus

# --- 判断のロジック ---


def test_plan_reads_original_only_for_listeners_of_the_same_language() -> None:
    assert plan_text("ja", ["ja", "en", "ko", "en"]) == TextPlan(True, ["en", "ko"])
    assert plan_text("ja", ["en"]) == TextPlan(False, ["en"])


def test_plan_ignores_unknown_listener_languages() -> None:
    assert plan_text("ja", [None, "ja"]) == TextPlan(True, [])


def test_plan_with_unknown_sender_language_translates_into_all() -> None:
    assert plan_text(None, ["ja", "en", None]) == TextPlan(False, ["en", "ja"])


def test_plan_with_nobody_else() -> None:
    assert plan_text("ja", []) == TextPlan(False, [])


def test_clean_text() -> None:
    assert clean_text("  はい。 \n", 10) == "はい。"
    assert clean_text("   ", 10) is None
    assert clean_text("a" * 11, 10) is None
    assert clean_text("a" * 10, 10) == "a" * 10


def test_parse_text_message() -> None:
    data = TextMessage(message_id="m1", text="はい").SerializeToString()
    assert parse_text_message(data) == TextMessage(message_id="m1", text="はい")
    assert parse_text_message(b"\xff\xff\xff") is None


def test_recent_messages_remembers_processed_messages() -> None:
    now = [0.0]
    recent: RecentMessages[str] = RecentMessages(ttl_s=10, max_size=3, clock=lambda: now[0])

    assert recent.get("a", "m1") is None
    recent.add("a", "m1", "記録")
    assert recent.get("a", "m1") == "記録"
    # 送信者が違えば別のメッセージ(message_id はアプリが振るので重なりうる)
    assert recent.get("b", "m1") is None
    # message_id が空なら見分けられないので覚えない
    recent.add("a", "", "空")
    assert recent.get("a", "") is None
    # ttl を過ぎたら忘れる
    now[0] = 10.0
    assert recent.get("a", "m1") is None


def test_recent_messages_forgets_oldest_over_max_size() -> None:
    recent: RecentMessages[int] = RecentMessages(ttl_s=100, max_size=2, clock=lambda: 0.0)
    for i, m in enumerate(["m1", "m2", "m3"]):
        recent.add("a", m, i)
    assert recent.get("a", "m3") == 2
    assert recent.get("a", "m1") is None


def test_translation_schema_and_input() -> None:
    schema = translations_schema(["en", "ko"])
    assert schema["required"] == ["en", "ko"]
    assert schema["additionalProperties"] is False
    assert message_input("はい", "ja", ["en"]) == (
        "Source language: Japanese\nTarget languages: en (English)\n\nMessage:\nはい"
    )
    assert message_input("hi", None, ["ja"]).startswith("Target languages: ja (Japanese)")


# --- 流れ(翻訳・読み上げ・出口は偽物) ---


class FakeCaptions:
    def __init__(self) -> None:
        self.sent: list[Caption] = []

    def send(self, caption: Caption | None) -> None:
        if caption is not None:
            self.sent.append(caption)


class FakeReplies:
    """送信者だけに宛てて送ったもの。"""

    def __init__(self) -> None:
        self.captions: list[tuple[str, Caption]] = []
        self.statuses: list[tuple[str, TextStatus]] = []
        # 字幕と状態を送った順
        self.order: list[str] = []

    def send_to(self, identity: str, caption: Caption) -> None:
        self.captions.append((identity, caption))
        self.order.append("caption")

    def send_status(self, identity: str, status: TextStatus) -> None:
        self.statuses.append((identity, status))
        self.order.append(TextStatus.State.Name(status.state))

    def states(self) -> list[str]:
        return [TextStatus.State.Name(s.state) for _, s in self.statuses]


class FakeSink:
    def __init__(self, log: list[tuple[str, str, bytes | None]], language: str) -> None:
        self._log = log
        self._language = language

    def push(self, pcm: bytes) -> None:
        self._log.append(("push", self._language, pcm))

    def close(self) -> None:
        self._log.append(("close", self._language, None))


class FakeTts:
    sample_rate = 24000

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.started: dict[str, asyncio.Event] = {}
        self.transcripts: dict[str, str] = {}
        self.fail: set[str] = set()
        self.active: dict[str, int] = {}
        self.max_active: dict[str, int] = {}

    def event(self, language: str) -> asyncio.Event:
        return self.started.setdefault(language, asyncio.Event())

    def prepare(self, languages: Iterable[str]) -> None:
        pass

    def keep_only(self, languages: Iterable[str]) -> None:
        pass

    async def speak(
        self, text: str, language: str, on_audio: Callable[[bytes], None]
    ) -> SpeechResult:
        self.calls.append((language, text))
        self.event(language).set()
        self.active[language] = self.active.get(language, 0) + 1
        self.max_active[language] = max(self.max_active.get(language, 0), self.active[language])
        try:
            await asyncio.sleep(0.01)
            if language in self.fail:
                raise RuntimeError("失敗")
            on_audio(text.encode())
            return SpeechResult(transcript=self.transcripts.get(text, text))
        finally:
            self.active[language] -= 1

    async def aclose(self) -> None:
        pass


class FakeTranslator:
    def __init__(
        self,
        results: dict[str, str],
        *,
        wait_for: asyncio.Event | None = None,
        fail_after: int | None = None,
    ) -> None:
        self.results = results
        self.wait_for = wait_for
        self.fail_after = fail_after
        self.calls: list[tuple[str, str | None, list[str]]] = []

    async def translate_all(
        self, text: str, source: str | None, targets: list[str]
    ) -> AsyncIterator[tuple[str, str]]:
        self.calls.append((text, source, targets))
        if self.wait_for is not None:
            await asyncio.wait_for(self.wait_for.wait(), timeout=1)
        for i, lang in enumerate(targets):
            if self.fail_after is not None and i >= self.fail_after:
                raise RuntimeError("切断")
            if lang in self.results:
                yield lang, self.results[lang]


class FakeHistory:
    def __init__(self) -> None:
        self.originals: list[dict[str, Any]] = []
        self.translations: list[tuple[str, str, str | None]] = []

    def original(self, segment_id: str, text: str, **kwargs: Any) -> None:
        self.originals.append({"segment_id": segment_id, "text": text, **kwargs})

    def translation(self, segment_id: str, language: str, text: str | None) -> None:
        self.translations.append((segment_id, language, text))


NOW = datetime(2026, 10, 10, 1, 2, 3, tzinfo=UTC)


class Harness:
    def __init__(self, translator: FakeTranslator, tts: FakeTts | None = None) -> None:
        self.translator = translator
        self.tts = tts or FakeTts()
        self.captions = FakeCaptions()
        self.history = FakeHistory()
        self.replies = FakeReplies()
        self.audio: list[tuple[str, str, bytes | None]] = []
        self.opened: list[tuple[str, int]] = []
        self.accepted: list[tuple[str, str]] = []
        self.text = TextInput(
            translator,
            self.tts,
            self.captions,
            self._open,
            max_chars=100,
            history=self.history,
            on_accepted=lambda sender, text: self.accepted.append((sender, text)),
            replies=self.replies,
            now=lambda: NOW,
        )

    def _open(self, language: str, sample_rate: int) -> FakeSink:
        self.opened.append((language, sample_rate))
        return FakeSink(self.audio, language)

    def handle(
        self, sender_language: str | None, listeners: list[str | None], text: str, mid: str = "m1"
    ) -> None:
        asyncio.run(
            self.text.handle(
                "alice", sender_language, listeners, TextMessage(message_id=mid, text=text)
            )
        )


def test_original_then_translations_as_final_captions() -> None:
    h = Harness(FakeTranslator({"en": "Yes.", "ko": "네."}))
    h.handle("ja", ["ja", "en", "ko"], " はい。 ")
    first, *rest = h.captions.sent
    assert (first.language, first.translated, first.text, first.is_final) == (
        "ja",
        False,
        "はい。",
        True,
    )
    assert [(c.language, c.translated, c.text, c.is_final) for c in rest] == [
        ("en", True, "Yes.", True),
        ("ko", True, "네.", True),
    ]
    # 原文と訳で segment_id を共有し、message_id と送信者を入れる
    assert {c.segment_id for c in h.captions.sent} == {first.segment_id}
    assert {c.message_id for c in h.captions.sent} == {"m1"}
    assert {c.speaker_identity for c in h.captions.sent} == {"alice"}
    assert h.translator.calls == [("はい。", "ja", ["en", "ko"])]
    assert sorted(h.tts.calls) == [("en", "Yes."), ("ja", "はい。"), ("ko", "네.")]
    assert set(h.opened) == {("ja", 24000), ("en", 24000), ("ko", 24000)}


def test_original_speech_starts_without_waiting_for_translation() -> None:
    async def run() -> None:
        tts = FakeTts()
        # 原文の読み上げが始まるまで、翻訳は1つも返さない
        translator = FakeTranslator({"en": "Yes."}, wait_for=tts.event("ja"))
        h = Harness(translator, tts)
        await h.text.handle("alice", "ja", ["ja", "en"], TextMessage(message_id="m", text="はい"))
        assert tts.calls[0] == ("ja", "はい")
        assert ("en", "Yes.") in tts.calls

    asyncio.run(run())


def test_no_original_speech_without_same_language_listeners() -> None:
    h = Harness(FakeTranslator({"en": "Yes."}))
    h.handle("ja", ["en"], "はい")
    assert h.tts.calls == [("en", "Yes.")]
    # 原文の字幕は出す
    assert [c.translated for c in h.captions.sent] == [False, True]


def test_unknown_sender_language() -> None:
    h = Harness(FakeTranslator({"en": "Yes.", "ja": "はい"}))
    h.handle(None, ["ja", "en"], "Oui")
    assert h.captions.sent[0].language == ""
    assert h.translator.calls[0][1:] == (None, ["en", "ja"])
    assert sorted(h.tts.calls) == [("en", "Yes."), ("ja", "はい")]


def test_no_translation_call_without_targets() -> None:
    h = Harness(FakeTranslator({}))
    h.handle("ja", ["ja"], "はい")
    assert h.translator.calls == []
    assert h.tts.calls == [("ja", "はい")]


def test_empty_or_too_long_text_is_dropped() -> None:
    h = Harness(FakeTranslator({"en": "x"}))
    h.handle("ja", ["en"], "   ")
    h.handle("ja", ["en"], "あ" * 101)
    assert h.captions.sent == []
    assert h.tts.calls == []
    # 断ったテキストは push 通知も頼まない
    assert h.accepted == []


def test_accepted_text_is_reported_for_push() -> None:
    h = Harness(FakeTranslator({"en": "Yes."}))
    h.handle("ja", ["en"], " はい。 ")
    assert h.accepted == [("alice", "はい。")]


def test_translation_failure_keeps_languages_already_done(
    caplog: pytest.LogCaptureFixture,
) -> None:
    h = Harness(FakeTranslator({"en": "Yes.", "ko": "네."}, fail_after=1))
    with caplog.at_level(logging.WARNING):
        h.handle("ja", ["en", "ko"], "はい")
    assert [(c.language, c.translated) for c in h.captions.sent] == [("ja", False), ("en", True)]
    assert h.tts.calls == [("en", "Yes.")]
    assert "訳がそろわなかった言語: ko" in caplog.text


def test_speeches_of_the_same_language_do_not_overlap() -> None:
    async def run() -> None:
        # 2人がほぼ同時に送り、どちらも en に訳される
        h = Harness(FakeTranslator({"en": "Same."}))
        await asyncio.gather(
            h.text.handle("alice", "ja", ["en"], TextMessage(message_id="1", text="一")),
            h.text.handle("bob", "ko", ["en"], TextMessage(message_id="2", text="二")),
        )
        assert h.tts.calls == [("en", "Same."), ("en", "Same.")]
        assert h.tts.max_active["en"] == 1
        # 音声の出口は読み上げごとに開いて閉じ、順に流れる
        kinds = [(k, lang) for k, lang, _ in h.audio]
        assert kinds == [("push", "en"), ("close", "en"), ("push", "en"), ("close", "en")]

    asyncio.run(run())


def test_sink_is_closed_even_if_speech_fails() -> None:
    tts = FakeTts()
    tts.fail.add("en")
    h = Harness(FakeTranslator({"en": "Yes."}), tts)
    h.handle("ja", ["ja", "en"], "はい")
    assert ("close", "en", None) in h.audio
    assert ("push", "ja", "はい".encode()) in h.audio


def test_speech_mismatch_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    tts = FakeTts()
    tts.transcripts["今何時ですか?"] = "今は午後3時です。"
    h = Harness(FakeTranslator({}), tts)
    with caplog.at_level(logging.WARNING):
        h.handle("ja", ["ja"], "今何時ですか?")
    assert "読み上げのテキストが渡した文と違う" in caplog.text


# --- 履歴の保存 ---


def test_history_gets_original_and_translations() -> None:
    h = Harness(FakeTranslator({"en": "Yes.", "ko": "네."}))
    h.handle("ja", ["ja", "en", "ko"], "はい。")
    segment_id = h.captions.sent[0].segment_id
    assert h.history.originals == [
        {
            "segment_id": segment_id,
            "text": "はい。",
            "sender_id": "alice",
            "language": "ja",
            "occurred_at": NOW,
            "targets": ["en", "ko"],
            "kind": "text",
            # アプリが自分のテキストの行を見つけて消せるよう、message_id も保存する
            "message_id": "m1",
        }
    ]
    assert h.history.translations == [(segment_id, "en", "Yes."), (segment_id, "ko", "네.")]


def test_history_marks_missing_translations_as_failed() -> None:
    h = Harness(FakeTranslator({"en": "Yes.", "ko": "네."}, fail_after=1))
    h.handle("ja", ["en", "ko"], "はい")
    segment_id = h.captions.sent[0].segment_id
    assert h.history.translations == [(segment_id, "en", "Yes."), (segment_id, "ko", None)]


def test_history_is_not_called_for_dropped_text() -> None:
    h = Harness(FakeTranslator({"en": "x"}))
    h.handle("ja", ["en"], "   ")
    assert h.history.originals == []
    assert h.history.translations == []


# --- 送信者への受け付け・結果の通知と、送り直し ---


def test_status_accepted_then_completed_to_the_sender_only() -> None:
    h = Harness(FakeTranslator({"en": "Yes."}))
    h.handle("ja", ["ja", "en"], "はい")
    assert [(i, s.message_id) for i, s in h.replies.statuses] == [("alice", "m1"), ("alice", "m1")]
    assert h.replies.states() == ["STATE_ACCEPTED", "STATE_COMPLETED"]
    # 最初の処理では、字幕はルームに配信するだけで、送信者には別に送らない
    assert h.replies.captions == []


def test_rejected_text_reports_reason() -> None:
    h = Harness(FakeTranslator({"en": "x"}))
    h.handle("ja", ["en"], "   ", mid="empty")
    h.handle("ja", ["en"], "あ" * 101, mid="long")
    (_, empty), (_, long) = h.replies.statuses
    assert (empty.state, empty.reason, empty.max_chars) == (
        TextStatus.STATE_REJECTED,
        TextStatus.REASON_EMPTY,
        0,
    )
    assert (long.state, long.reason, long.max_chars) == (
        TextStatus.STATE_REJECTED,
        TextStatus.REASON_TOO_LONG,
        100,
    )


def test_failed_translation_and_speech_are_reported() -> None:
    tts = FakeTts()
    tts.fail.add("ja")
    h = Harness(FakeTranslator({"en": "Yes.", "ko": "네."}, fail_after=1), tts)
    h.handle("ja", ["ja", "en", "ko"], "はい")
    assert h.replies.states() == ["STATE_ACCEPTED", "STATE_FAILED"]
    final = h.replies.statuses[-1][1]
    assert list(final.untranslated_languages) == ["ko"]
    assert list(final.unspoken_languages) == ["ja"]


def test_no_status_without_message_id() -> None:
    h = Harness(FakeTranslator({"en": "Yes."}))
    h.handle("ja", ["en"], "はい", mid="")
    assert h.replies.statuses == []
    # message_id が空のものは見分けられないので、2回目も処理する
    h.handle("ja", ["en"], "はい", mid="")
    assert h.translator.calls == [("はい", "ja", ["en"])] * 2


def test_resent_message_gets_captions_and_status_again_without_reprocessing() -> None:
    h = Harness(FakeTranslator({"en": "Yes.", "ko": "네."}))
    h.handle("ja", ["ja", "en", "ko"], "はい")
    broadcast = list(h.captions.sent)
    h.handle("ja", ["ja", "en", "ko"], "はい")

    # 翻訳と読み上げはやり直さず、ルームにも配信し直さない
    assert len(h.translator.calls) == 1
    assert len(h.tts.calls) == 3
    assert h.captions.sent == broadcast
    assert len(h.history.originals) == 1
    # 配信した字幕(原文と訳)を、同じ segment_id のまま送信者にだけ送り直し、最後に状態を送る
    assert [(i, c) for i, c in h.replies.captions] == [("alice", c) for c in broadcast]
    assert h.replies.order[-4:] == ["caption", "caption", "caption", "STATE_COMPLETED"]


def test_resent_rejected_message_gets_rejected_again() -> None:
    h = Harness(FakeTranslator({}))
    h.handle("ja", ["en"], "あ" * 101)
    h.handle("ja", ["en"], "あ" * 101)
    assert h.replies.states() == ["STATE_REJECTED", "STATE_REJECTED"]
    assert h.replies.captions == []


def test_resent_while_processing_gets_what_is_ready() -> None:
    async def run() -> None:
        gate = asyncio.Event()
        h = Harness(FakeTranslator({"en": "Yes."}, wait_for=gate))
        first = asyncio.create_task(
            h.text.handle("alice", "ja", ["en"], TextMessage(message_id="m", text="はい"))
        )
        await asyncio.sleep(0)
        # 訳を待っている間に送り直された: 原文の字幕と ACCEPTED を送り直す
        await h.text.handle("alice", "ja", ["en"], TextMessage(message_id="m", text="はい"))
        assert [c.translated for _, c in h.replies.captions] == [False]
        assert h.replies.states() == ["STATE_ACCEPTED", "STATE_ACCEPTED"]
        gate.set()
        await first
        # 残りの訳はルームに配信し、結果も送る
        assert [c.translated for c in h.captions.sent] == [False, True]
        assert h.replies.states()[-1] == "STATE_COMPLETED"
        assert len(h.translator.calls) == 1

    asyncio.run(run())


def test_resend_from_another_sender_is_a_new_message() -> None:
    async def run() -> None:
        h = Harness(FakeTranslator({"en": "Yes."}))
        await h.text.handle("alice", "ja", ["en"], TextMessage(message_id="m", text="はい"))
        await h.text.handle("bob", "ja", ["en"], TextMessage(message_id="m", text="はい"))
        assert len(h.translator.calls) == 2
        assert {i for i, _ in h.replies.statuses} == {"alice", "bob"}

    asyncio.run(run())
