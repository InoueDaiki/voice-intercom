"""録音(recording.py)。S3 は偽の Uploader に差し替え、エンコードは本物の PyAV で確かめる。"""

import asyncio
import io
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from typing import IO, Any

import av
import numpy as np
import pytest

from voice_intercom_agent import recording
from voice_intercom_agent.recording import (
    SAMPLE_RATE,
    OggOpusEncoder,
    Recorder,
    RecordingSettings,
    recording_key,
    recording_metadata,
)

T0 = datetime(2026, 10, 10, 1, 2, 3, 456789, tzinfo=UTC)
UTTERANCE_ID = "0123456789abcdef0123456789abcdef"


def sine_pcm(seconds: float, *, freq: float = 440.0) -> bytes:
    t = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    return (np.sin(2 * np.pi * freq * t) * 8000).astype(np.int16).tobytes()


def frames(pcm: bytes, *, samples: int = 240) -> list[bytes]:
    """AudioStream と同じく 10ms(240サンプル)ずつに分ける。"""
    step = samples * 2
    return [pcm[i : i + step] for i in range(0, len(pcm), step)]


@dataclass
class Decoded:
    codec: str
    channels: int
    duration_s: float


def decode(data: bytes) -> Decoded:
    with av.open(io.BytesIO(data), mode="r") as container:
        stream = container.streams.audio[0]
        rate = stream.rate
        samples = sum(f.samples for f in container.decode(stream))
        return Decoded(stream.codec_context.name, stream.codec_context.channels, samples / rate)


# ---- キーとメタデータ ----


def test_key_has_room_date_utterance_and_speaker() -> None:
    assert (
        recording_key("room-1", T0, UTTERANCE_ID, "user-1")
        == f"rooms/room-1/2026/10/10/{UTTERANCE_ID}-user-1.ogg"
    )


def test_key_date_is_utc() -> None:
    # 日本時間の 10/11 08:59 は UTC の 10/10
    jst = timezone(timedelta(hours=9))
    started = datetime(2026, 10, 11, 8, 59, tzinfo=jst)
    assert recording_key("r", started, UTTERANCE_ID, "s").startswith("rooms/r/2026/10/10/")


def test_key_escapes_slashes_and_non_ascii() -> None:
    key = recording_key("a/b", T0, UTTERANCE_ID, "話者 1")
    assert key == f"rooms/a%2Fb/2026/10/10/{UTTERANCE_ID}-%E8%A9%B1%E8%80%85%201.ogg"
    # 空のルーム名でも、接頭辞の階層は崩さない
    assert recording_key("", T0, UTTERANCE_ID, "s").startswith("rooms/_/2026/")


def test_metadata_is_ascii() -> None:
    meta = recording_metadata(
        room_id="room-1",
        utterance_id=UTTERANCE_ID,
        speaker_id="話者",
        language="ja",
        started_at=T0,
        duration_s=1.5,
    )
    assert meta == {
        "room-id": "room-1",
        "utterance-id": UTTERANCE_ID,
        "speaker-id": "%E8%A9%B1%E8%80%85",
        "language": "ja",
        "started-at": "2026-10-10T01:02:03.456Z",
        "duration-s": "1.500",
    }
    assert all(v.isascii() for v in meta.values())
    no_language = recording_metadata(
        room_id="r", utterance_id="u", speaker_id="s", language=None, started_at=T0, duration_s=0
    )
    assert no_language["language"] == ""


def test_settings_from_env_needs_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RECORDING_BUCKET", raising=False)
    assert RecordingSettings.from_env() is None
    monkeypatch.setenv("RECORDING_BUCKET", "bucket-1")
    monkeypatch.setenv("RECORDING_BITRATE", "32000")
    settings = RecordingSettings.from_env()
    assert settings is not None
    assert settings.bucket == "bucket-1"
    assert settings.bitrate == 32000
    # livekit-agents の終了処理の10秒より短い
    assert settings.flush_timeout_s < 10


# ---- エンコード ----


def test_encoder_writes_readable_ogg_opus_with_the_same_length() -> None:
    out = io.BytesIO()
    encoder = OggOpusEncoder(out, bitrate=24000)
    pcm = sine_pcm(1.5)
    # 半端な大きさに分けて渡しても、つなぎ目で欠けない
    for i in range(0, len(pcm), 4802):
        encoder.write(pcm[i : i + 4802])
    encoder.close()
    assert encoder.duration_s == pytest.approx(1.5)
    data = out.getvalue()
    assert data[:4] == b"OggS"
    decoded = decode(data)
    assert decoded.codec == "opus"
    assert decoded.channels == 1
    assert decoded.duration_s == pytest.approx(1.5, abs=0.02)
    # 24kbps なら 1.5秒で数 KB(PCM の 72KB よりずっと小さい)
    assert len(data) < 15_000


def test_encoder_close_is_idempotent_and_keeps_output_open() -> None:
    out = io.BytesIO()
    encoder = OggOpusEncoder(out)
    encoder.write(sine_pcm(0.1))
    encoder.close()
    encoder.close()
    assert not out.closed


# ---- Recorder(偽の Uploader) ----


@dataclass
class FakeUploader:
    # 先頭から順に投げる例外。尽きたら成功
    failures: list[Exception] = field(default_factory=list)
    delay_s: float = 0.0
    calls: int = 0
    # (key, data, metadata)
    puts: list[tuple[str, bytes, dict[str, str]]] = field(default_factory=list)

    async def put(self, key: str, body: IO[bytes], metadata: dict[str, str]) -> None:
        self.calls += 1
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.failures:
            raise self.failures.pop(0)
        body.seek(0)
        self.puts.append((key, body.read(), metadata))


def make_recorder(uploader: Any, **kwargs: Any) -> Recorder:
    kwargs.setdefault("retry_base_s", 0.01)
    return Recorder(uploader, lambda: "room-1", **kwargs)


def start(recorder: Recorder, utterance_id: str = UTTERANCE_ID) -> Any:
    return recorder.start(
        utterance_id=utterance_id, speaker_id="user-1", language="ja", started_at=T0
    )


def test_one_utterance_is_saved_once_after_finish() -> None:
    async def main() -> FakeUploader:
        uploader = FakeUploader()
        recorder = make_recorder(uploader)
        rec = start(recorder)
        for f in frames(sine_pcm(2.3)):
            rec.push(f)
        await asyncio.sleep(0.05)
        # 発話が終わるまでは保存しない
        assert uploader.calls == 0
        rec.finish()
        rec.finish()
        # 終わった後に届いたフレームは捨てる
        rec.push(sine_pcm(1.0))
        await recorder.aclose()
        return uploader

    uploader = asyncio.run(main())
    assert len(uploader.puts) == 1
    key, data, meta = uploader.puts[0]
    assert key == f"rooms/room-1/2026/10/10/{UTTERANCE_ID}-user-1.ogg"
    assert meta["duration-s"] == "2.300"
    assert meta["speaker-id"] == "user-1"
    assert meta["language"] == "ja"
    assert decode(data).duration_s == pytest.approx(2.3, abs=0.02)


def test_utterance_without_audio_is_not_saved() -> None:
    async def main() -> FakeUploader:
        uploader = FakeUploader()
        recorder = make_recorder(uploader)
        start(recorder).finish()
        await recorder.aclose()
        return uploader

    assert asyncio.run(main()).calls == 0


def test_upload_is_retried() -> None:
    async def main() -> FakeUploader:
        uploader = FakeUploader(failures=[OSError("1"), OSError("2")])
        recorder = make_recorder(uploader, max_attempts=3)
        rec = start(recorder)
        rec.push(sine_pcm(0.5))
        rec.finish()
        await recorder.aclose()
        return uploader

    uploader = asyncio.run(main())
    assert uploader.calls == 3
    assert len(uploader.puts) == 1
    # やり直しでも先頭から送る
    assert uploader.puts[0][1][:4] == b"OggS"


def test_upload_gives_up_after_max_attempts() -> None:
    async def main() -> FakeUploader:
        uploader = FakeUploader(failures=[OSError(str(i)) for i in range(5)])
        recorder = make_recorder(uploader, max_attempts=3)
        rec = start(recorder)
        rec.push(sine_pcm(0.5))
        rec.finish()
        await recorder.aclose()
        return uploader

    uploader = asyncio.run(main())
    assert uploader.calls == 3
    assert uploader.puts == []


def test_aclose_finishes_open_recordings() -> None:
    # 退室などで発話の終わりが届かないままジョブが終わっても、そこまでを保存する
    async def main() -> FakeUploader:
        uploader = FakeUploader()
        recorder = make_recorder(uploader)
        rec = start(recorder)
        rec.push(sine_pcm(0.7))
        await recorder.aclose()
        # 閉じた後の発話は録らない
        start(recorder, "f" * 32).push(sine_pcm(0.5))
        return uploader

    uploader = asyncio.run(main())
    assert len(uploader.puts) == 1
    assert uploader.puts[0][2]["duration-s"] == "0.700"


def test_aclose_gives_up_after_flush_timeout() -> None:
    async def main() -> tuple[FakeUploader, float]:
        uploader = FakeUploader(delay_s=10)
        recorder = make_recorder(uploader, flush_timeout_s=0.2)
        rec = start(recorder)
        rec.push(sine_pcm(0.3))
        rec.finish()
        loop = asyncio.get_running_loop()
        t = loop.time()
        await recorder.aclose()
        return uploader, loop.time() - t

    uploader, elapsed = asyncio.run(main())
    assert elapsed < 2
    assert uploader.puts == []


def test_disabled_recorder_does_nothing() -> None:
    async def main() -> None:
        recorder = Recorder(None, lambda: "room-1")
        assert not recorder.enabled
        rec = start(recorder)
        rec.push(sine_pcm(0.1))
        rec.finish()
        await recorder.aclose()

    asyncio.run(main())


def test_create_recorder_without_bucket_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RECORDING_BUCKET", raising=False)
    assert not recording.create_recorder(lambda: "r").enabled
    monkeypatch.setenv("RECORDING_BUCKET", "bucket-1")
    assert recording.create_recorder(lambda: "r").enabled


def test_encoder_abort_closes_container_and_is_idempotent() -> None:
    encoder = OggOpusEncoder(io.BytesIO())
    encoder.write(sine_pcm(0.1))
    container = encoder._container  # pyright: ignore[reportPrivateUsage]
    closed: list[bool] = []
    encoder._container = _CountingContainer(container, closed)  # pyright: ignore[reportPrivateUsage]
    encoder.abort()
    encoder.abort()
    encoder.close()
    assert closed == [True]


class _CountingContainer:
    def __init__(self, inner: Any, closed: list[bool]) -> None:
        self._inner = inner
        self._closed = closed

    def close(self) -> None:
        self._closed.append(True)
        self._inner.close()


def test_failed_encoding_closes_the_encoder(monkeypatch: pytest.MonkeyPatch) -> None:
    aborted: list[bool] = []

    class Failing(OggOpusEncoder):
        def write(self, pcm: bytes) -> None:
            raise RuntimeError("エンコードできない")

        def abort(self) -> None:
            aborted.append(True)
            super().abort()

    monkeypatch.setattr(recording, "OggOpusEncoder", Failing)

    async def main() -> None:
        recorder = Recorder(FakeUploader(), lambda: "room-1")
        rec = recorder.start(
            utterance_id=UTTERANCE_ID, speaker_id="s", language="ja", started_at=T0
        )
        rec.push(sine_pcm(1.1))
        rec.finish()
        await recorder.aclose()

    asyncio.run(main())
    assert aborted == [True]
