"""ジョブの終わりと購読のし直し(agent.py)。OpenAI と LiveKit は偽物に差し替える。"""

import asyncio
from collections.abc import AsyncIterator, Callable
from dataclasses import replace
from types import SimpleNamespace
from typing import Any, cast

import pytest

from voice_intercom_agent import agent as agent_module
from voice_intercom_agent.agent import IntercomAgent, Utterance
from voice_intercom_agent.config import Settings

SETTINGS = Settings(
    openai_api_key="key",
    translate_model="t",
    whisper_model="w",
    text_translate_model="m",
    translate_close_timeout_s=40,
    translate_tail_silence_s=0,
    translate_trim_tail=True,
    whisper_commit_timeout_s=10,
    segment_rules=None,
    tts_model="tts",
    tts_voice="marin",
    tts_timeout_s=30,
    tts_prewarm=False,
    tts_idle_close_s=60,
    text_max_chars=500,
    shutdown_drain_s=1.0,
)


class FakeRoom:
    name = "room-1"
    remote_participants: dict[str, Any] = {}

    def on(self, *_: object) -> None:
        pass

    def isconnected(self) -> bool:
        return False


class FakeWhisper:
    """finish() の後、commit_s たってから全文を確定する。hang なら確定しない。"""

    commit_s = 0.05
    hang = False

    def __init__(self, *_: object, on_completed: Callable[[int, str], None], **__: object) -> None:
        self._on_completed = on_completed
        self._finished = asyncio.Event()

    def push(self, pcm: bytes) -> None:
        pass

    def finish(self) -> None:
        self._finished.set()

    async def run(self) -> None:
        try:
            await self._finished.wait()
            if self.hang:
                await asyncio.Event().wait()
            await asyncio.sleep(self.commit_s)
            self._on_completed(0, "最後の発話")
        except asyncio.CancelledError:
            self._on_completed(0, "")
            raise


class FakeTranslator:
    def __init__(self, hang: bool = False) -> None:
        self.hang = hang

    async def stream(self, text: str, source: str | None, target: str) -> AsyncIterator[str]:
        if self.hang:
            await asyncio.Event().wait()
        await asyncio.sleep(0.05)
        yield "last words"


class SpyHistory:
    def __init__(self) -> None:
        self.originals: list[str] = []
        self.translations: list[str | None] = []
        self.closed = False

    def original(self, segment_id: str, text: str, **_: object) -> None:
        self.originals.append(text)

    def translation(self, segment_id: str, language: str, text: str | None) -> None:
        self.translations.append(text)

    async def aclose(self) -> None:
        self.closed = True


class FakeSpeaker:
    created: list[FakeSpeaker] = []

    def __init__(self, *_: object) -> None:
        self.closed = False
        FakeSpeaker.created.append(self)

    def subscribed(self, *, muted: bool) -> None:
        pass

    async def aclose(self) -> None:
        self.closed = True


def make_agent(translator: FakeTranslator, settings: Settings = SETTINGS) -> IntercomAgent:
    return IntercomAgent(cast(Any, FakeRoom()), settings, cast(Any, translator))


def history_of(agent: IntercomAgent) -> SpyHistory:
    spy = SpyHistory()
    agent._deps.history = cast(Any, spy)  # pyright: ignore[reportPrivateUsage]
    return spy


def utterance(agent: IntercomAgent) -> Utterance:
    deps = agent._deps  # pyright: ignore[reportPrivateUsage]
    return Utterance(deps, "speaker", "ja", ["en"], [])


@pytest.fixture(autouse=True)
def fakes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_module, "WhisperSession", FakeWhisper)
    monkeypatch.setattr(FakeWhisper, "hang", False)
    monkeypatch.delenv("RECORDING_BUCKET", raising=False)
    monkeypatch.delenv("API_BASE_URL", raising=False)


def test_aclose_waits_for_the_last_transcript_and_translation() -> None:
    async def main() -> SpyHistory:
        agent = make_agent(FakeTranslator())
        spy = history_of(agent)
        u = utterance(agent)
        u.start()
        # PTT を離した直後にジョブが終わる
        u.finish()
        await agent.aclose()
        return spy

    spy = asyncio.run(main())
    assert spy.originals == ["最後の発話"]
    assert spy.translations == ["last words"]
    assert spy.closed


def test_aclose_gives_up_after_the_limit() -> None:
    FakeWhisper.hang = True

    async def main() -> SpyHistory:
        agent = make_agent(FakeTranslator(), replace(SETTINGS, shutdown_drain_s=0.05))
        spy = history_of(agent)
        u = utterance(agent)
        u.start()
        u.finish()
        await asyncio.wait_for(agent.aclose(), timeout=1)
        return spy

    spy = asyncio.run(main())
    # 上限を過ぎたら、これまでどおり空の全文で確定して先へ進む
    assert spy.originals == [""]
    assert spy.closed


def test_translation_task_is_cancelled_with_the_background() -> None:
    async def main() -> tuple[SpyHistory, int]:
        agent = make_agent(FakeTranslator(hang=True), replace(SETTINGS, shutdown_drain_s=0.15))
        spy = history_of(agent)
        u = utterance(agent)
        u.start()
        u.finish()
        await asyncio.sleep(0.1)
        # 訳のタスクが background に入っている
        background = len(agent._deps.background)  # pyright: ignore[reportPrivateUsage]
        await asyncio.wait_for(agent.aclose(), timeout=1)
        left = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        assert left == []
        return spy, background

    spy, background = asyncio.run(main())
    assert background == 3  # 書き起こし、翻訳音声、訳
    assert spy.originals == ["最後の発話"]
    assert spy.translations == []


def test_resubscribing_the_same_sid_closes_the_previous_speaker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(agent_module, "Speaker", FakeSpeaker)
    FakeSpeaker.created = []

    async def main() -> None:
        agent = make_agent(FakeTranslator())
        rtc = agent_module.rtc
        track = SimpleNamespace(kind=rtc.TrackKind.KIND_AUDIO)
        publication = SimpleNamespace(
            sid="TR_1", source=rtc.TrackSource.SOURCE_MICROPHONE, muted=False
        )
        participant = SimpleNamespace(kind=rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD)
        subscribe = agent._on_track_subscribed  # pyright: ignore[reportPrivateUsage]
        subscribe(cast(Any, track), cast(Any, publication), cast(Any, participant))
        subscribe(cast(Any, track), cast(Any, publication), cast(Any, participant))
        await asyncio.sleep(0)
        first, second = FakeSpeaker.created
        assert first.closed
        assert not second.closed
        await agent.aclose()
        assert second.closed

    asyncio.run(main())
