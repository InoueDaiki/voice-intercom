import asyncio
from types import SimpleNamespace
from typing import Any, cast

import numpy as np
import pytest

from voice_intercom_agent import output
from voice_intercom_agent.output import (
    CHUNK_SAMPLES,
    TRACK_SAMPLE_RATE,
    AudioInput,
    TranslationTrack,
)
from voice_intercom_agent.realtime import OUTPUT_SAMPLE_RATE


class FakeTrack:
    def __init__(self) -> None:
        self.pushed: dict[object, list[bytes]] = {}
        self.closed: list[object] = []

    def push(self, key: object, pcm: bytes) -> None:
        self.pushed.setdefault(key, []).append(pcm)

    def close(self, key: object) -> None:
        self.closed.append(key)


def dominant_hz(pcm: bytes, rate: int) -> float:
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
    spec = np.abs(np.fft.rfft(x))
    return float(np.fft.rfftfreq(len(x), 1 / rate)[np.argmax(spec)])


def test_translated_audio_is_resampled_to_track_rate_keeping_pitch() -> None:
    # 翻訳音声(24kHz)の 1秒の 440Hz が、トラック(48kHz)でも 1秒の 440Hz のまま流れる
    t = np.arange(OUTPUT_SAMPLE_RATE) / OUTPUT_SAMPLE_RATE
    tone = (np.sin(2 * np.pi * 440 * t) * 10000).astype(np.int16).tobytes()
    track = FakeTrack()
    key = object()
    audio = AudioInput(track, key, OUTPUT_SAMPLE_RATE)  # type: ignore[arg-type]
    # 届くチャンク(9600 サンプル)に分けて渡す
    step = 9600 * 2
    for i in range(0, len(tone), step):
        audio.push(tone[i : i + step])
    audio.close()
    out = b"".join(track.pushed[key])
    assert track.closed == [key]
    assert abs(len(out) / 2 - TRACK_SAMPLE_RATE) <= TRACK_SAMPLE_RATE * 0.01
    assert abs(dominant_hz(out, TRACK_SAMPLE_RATE) - 440) < 5


def test_audio_at_track_rate_is_passed_through() -> None:
    track = FakeTrack()
    audio = AudioInput(track, "k", TRACK_SAMPLE_RATE)  # type: ignore[arg-type]
    audio.push(b"\x01\x00\x02\x00")
    audio.close()
    assert track.pushed == {"k": [b"\x01\x00\x02\x00"]}
    assert track.closed == ["k"]


class FakeSource:
    def __init__(self, *_: object) -> None:
        self.frames = 0
        self.fail_captures = 0

    async def capture_frame(self, frame: object) -> None:
        if self.fail_captures > 0:
            self.fail_captures -= 1
            raise RuntimeError("送れない")
        self.frames += 1

    async def aclose(self) -> None:
        pass


class FakeLocalParticipant:
    def __init__(self, failures: int) -> None:
        self.failures = failures
        self.calls = 0

    async def publish_track(self, *_: object) -> None:
        self.calls += 1
        if self.calls <= self.failures:
            raise RuntimeError("公開できない")


CHUNK = bytes(CHUNK_SAMPLES * 2)


@pytest.fixture
def fake_rtc(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(output.rtc, "AudioSource", FakeSource)
    monkeypatch.setattr(
        output.rtc.LocalAudioTrack, "create_audio_track", staticmethod(lambda *_: object())
    )
    monkeypatch.setattr(output, "RETRY_BASE_S", 0.02)


def make_track(failures: int) -> tuple[TranslationTrack, FakeLocalParticipant]:
    participant = FakeLocalParticipant(failures)
    room = SimpleNamespace(local_participant=participant)
    return TranslationTrack(cast(Any, room), "en"), participant


@pytest.mark.usefixtures("fake_rtc")
def test_track_retries_publishing_and_drops_audio_while_down(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def main() -> None:
        track, participant = make_track(failures=1)
        await asyncio.sleep(0.005)
        # 止まっている間の音声は、ためずに捨てる
        track.push("k", CHUNK)
        assert track._mixer.pop() is None  # pyright: ignore[reportPrivateUsage]
        await asyncio.sleep(0.05)
        assert participant.calls == 2
        # 公開できたら、また流れる
        track.push("k", CHUNK)
        await asyncio.sleep(0.01)
        assert cast(Any, track._source).frames == 1  # pyright: ignore[reportPrivateUsage]
        await track.aclose()

    asyncio.run(main())
    assert "翻訳音声のトラック(en)が止まった" in caplog.text


@pytest.mark.usefixtures("fake_rtc")
def test_track_survives_capture_failure_without_republishing() -> None:
    async def main() -> None:
        track, participant = make_track(failures=0)
        source = cast(Any, track._source)  # pyright: ignore[reportPrivateUsage]
        source.fail_captures = 1
        track.push("k", CHUNK * 3)
        await asyncio.sleep(0.005)
        # 失敗したら、残りの音声も捨てる
        assert track._mixer.pop() is None  # pyright: ignore[reportPrivateUsage]
        await asyncio.sleep(0.05)
        track.push("k", CHUNK)
        await asyncio.sleep(0.01)
        assert source.frames == 1
        assert participant.calls == 1
        await track.aclose()

    asyncio.run(main())
