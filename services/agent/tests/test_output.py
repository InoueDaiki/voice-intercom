import numpy as np

from voice_intercom_agent.output import TRACK_SAMPLE_RATE, AudioInput
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
