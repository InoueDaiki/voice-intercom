"""translate の close の後の末尾の無音を捨てる(silence_trim.py)。通信はしない。"""

import asyncio
import base64
from typing import Any, cast

import numpy as np

from voice_intercom_agent.realtime import OUTPUT_SAMPLE_RATE, TranslateSession
from voice_intercom_agent.silence_trim import KEEP_S, TrailingSilenceTrimmer

RATE = 24000
KEEP = round(RATE * KEEP_S)


def tone(seconds: float, amplitude: int = 3000) -> np.ndarray:
    n = round(RATE * seconds)
    return (amplitude * np.sin(np.arange(n) * 2 * np.pi * 220 / RATE)).astype(np.int16)


def silence(seconds: float, peak: int = 1) -> np.ndarray:
    # PoC の記録の無音は、最大の振幅が 0〜1
    n = round(RATE * seconds)
    out = np.zeros(n, dtype=np.int16)
    out[::997] = peak
    return out


def chunks(pcm: np.ndarray, size: int = 9600) -> list[bytes]:
    return [pcm[i : i + size].tobytes() for i in range(0, len(pcm), size)]


class Out:
    def __init__(self) -> None:
        self.parts: list[bytes] = []

    def __call__(self, pcm: bytes) -> None:
        self.parts.append(pcm)

    @property
    def samples(self) -> np.ndarray:
        return np.frombuffer(b"".join(self.parts), dtype=np.int16)


def run(before: np.ndarray, after: np.ndarray) -> tuple[np.ndarray, float]:
    out = Out()
    t = TrailingSilenceTrimmer(out, RATE)
    for c in chunks(before):
        t.push(c)
    t.closed()
    for c in chunks(after):
        t.push(c)
    dropped = t.finish()
    return out.samples, dropped


def test_drops_trailing_silence_after_close_keeping_a_little() -> None:
    voice = tone(1.0)
    got, dropped = run(np.array([], dtype=np.int16), np.concatenate([voice, silence(15.0)]))
    assert np.array_equal(got[: len(voice)], voice)
    assert len(got) == len(voice) + KEEP
    assert abs(dropped - (15.0 - KEEP_S)) < 0.01


def test_audio_before_close_is_untouched_even_if_silent() -> None:
    before = np.concatenate([tone(0.5), silence(3.0)])
    got, dropped = run(before, np.array([], dtype=np.int16))
    assert np.array_equal(got, before)
    assert dropped == 0


def test_pause_inside_translation_after_close_is_kept() -> None:
    # close の後の訳の途中の間(2秒)は、後ろに声が来るので捨てない
    after = np.concatenate([tone(0.6), silence(2.0), tone(0.6), silence(10.0)])
    got, _ = run(np.array([], dtype=np.int16), after)
    voiced = round(RATE * 3.2)
    assert np.array_equal(got[:voiced], after[:voiced])
    assert len(got) == voiced + KEEP


def test_quiet_voice_at_the_end_is_kept() -> None:
    # 末尾の小さな声(最大の振幅 40。-58 dBFS ほど)と、声の終わりの減衰は削らない
    quiet = tone(0.3, amplitude=40)
    decay = np.array([113, -42, 9, -5, 3, 0, 1, 0], dtype=np.int16)
    after = np.concatenate([tone(0.5), quiet, decay, silence(12.0)])
    got, _ = run(np.array([], dtype=np.int16), after)
    head = round(RATE * 0.8) + 3  # 減衰の 9 まではフレームの中なので必ず残る
    assert np.array_equal(got[:head], after[:head])
    assert len(got) >= round(RATE * 0.8) + KEEP


def test_silence_only_after_close() -> None:
    got, dropped = run(tone(0.5), silence(13.0))
    assert len(got) == round(RATE * 0.5) + KEEP
    assert abs(dropped - (13.0 - KEEP_S)) < 0.01


def test_short_silence_after_close_is_kept_whole() -> None:
    after = np.concatenate([tone(0.5), silence(0.1)])
    got, dropped = run(np.array([], dtype=np.int16), after)
    assert np.array_equal(got, after)
    assert dropped == 0


# --- TranslateSession に組み込んだ形 ---


class FakeWs:
    async def send_json(self, data: dict[str, Any]) -> None:
        pass


def session(out: Out, *, trim_tail: bool = True) -> TranslateSession:
    return TranslateSession(
        cast(Any, None),
        "key",
        model="gpt-realtime-translate",
        language="en",
        close_timeout_s=40,
        tail_silence_s=0,
        on_audio=out,
        on_done=lambda: None,
        trim_tail=trim_tail,
    )


def delta(pcm: bytes) -> dict[str, Any]:
    return {"type": "session.output_audio.delta", "delta": base64.b64encode(pcm).decode()}


def feed(s: TranslateSession, before: np.ndarray, after: np.ndarray) -> None:
    for c in chunks(before):
        s._handle(delta(c))  # pyright: ignore[reportPrivateUsage]
    asyncio.run(s._send_end(cast(Any, FakeWs())))  # pyright: ignore[reportPrivateUsage]
    for c in chunks(after):
        s._handle(delta(c))  # pyright: ignore[reportPrivateUsage]
    s._handle({"type": "session.closed"})  # pyright: ignore[reportPrivateUsage]
    s._on_done()  # pyright: ignore[reportPrivateUsage]


def test_translate_session_trims_after_close() -> None:
    assert OUTPUT_SAMPLE_RATE == RATE
    out = Out()
    before = np.concatenate([tone(0.4), silence(0.8), tone(0.4)])
    after = np.concatenate([tone(0.8), silence(14.0)])
    feed(session(out), before, after)
    expected = np.concatenate([before, after[: round(RATE * 0.8) + KEEP]])
    assert np.array_equal(out.samples, expected)


def test_translate_session_can_disable_trimming() -> None:
    out = Out()
    after = np.concatenate([tone(0.8), silence(14.0)])
    feed(session(out, trim_tail=False), tone(0.4), after)
    assert len(out.samples) == round(RATE * 0.4) + len(after)
