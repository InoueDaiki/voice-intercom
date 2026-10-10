"""話者ごと・発話ごとの録音を、Ogg/Opus にして S3 に保存する。

- 1回の発話(ミュート解除から、ミュート・unpublish・退室まで)を1ファイルにする。音声は話者の
  元の音声(翻訳音声ではない)で、OpenAI に送るために受け取っているフレーム(24kHz・PCM16・
  モノラル)をそのまま使う。購読は増やさない。
- エンコードは PyAV(livekit-agents が既に依存している。FFmpeg の libopus)で、発話の間に
  少しずつ行う。PCM を約1秒ためてはスレッドに渡し、イベントループを止めない。
  出力は SpooledTemporaryFile に書き、大きくなったらディスクに逃がす。
- 発話が終わったら、バックグラウンドで S3 に PUT する(大きいものは boto3 がマルチパートにする)。
  失敗したら間隔を空けて数回やり直す。ジョブの終わり(aclose)に、送り中のものを短く待つ。
- 保存先のキーは rooms/<room_id>/<YYYY>/<MM>/<DD>/<utterance_id>-<speaker_id>.ogg
  (日付は発話の開始時刻の UTC)。字幕と履歴の utterance_id、sender_id、occurred_at から引ける。

設定(RECORDING_BUCKET)が無ければ録音しない。Egress は使わない(設計メモの「録音の方式」)。
"""

import asyncio
import logging
import os
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import IO, Any, Protocol
from urllib.parse import quote

import av
import numpy as np

from .history import format_time

logger = logging.getLogger(__name__)

# 入力は realtime.py の INPUT_SAMPLE_RATE と同じ(24kHz・PCM16・モノラル)。Opus はこのまま扱える
SAMPLE_RATE = 24000
SAMPLE_WIDTH = 2

CONTENT_TYPE = "audio/ogg"
KEY_PREFIX = "rooms/"

# この長さの PCM がたまるごとに、スレッドでエンコードする
ENCODE_CHUNK_S = 1.0
# エンコードした出力をメモリに置く上限。超えたら一時ファイル(ディスク)に移る
SPOOL_MAX_BYTES = 8 * 1024 * 1024
# boto3 がマルチパートにする大きさ(既定と同じ 8MB)
MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024

# 設定が無いことを、プロセスで一度だけログに出すための印
_disabled_logged = False


@dataclass(frozen=True)
class RecordingSettings:
    bucket: str
    # Opus のビットレート(bps)。音声なら 24〜32kbps で足りる
    bitrate: int = 24000
    # PUT を試す回数(初回を含む)と、再送の間隔の基準(1, 2, 4... 倍にしていく)
    max_attempts: int = 3
    retry_base_s: float = 1.0
    # ジョブの終わりに送り中のものを待つ上限。
    # livekit-agents の shutdown_process_timeout(既定10秒)より短くする。履歴(history.py)の
    # 送り残しと同時に待つので、両方の長いほうが効く
    flush_timeout_s: float = 5.0

    @classmethod
    def from_env(cls) -> RecordingSettings | None:
        """RECORDING_BUCKET が無ければ None(録音しない)。"""
        bucket = os.environ.get("RECORDING_BUCKET", "").strip()
        if not bucket:
            global _disabled_logged
            if not _disabled_logged:
                _disabled_logged = True
                logger.info("録音は無効(RECORDING_BUCKET が未設定)")
            return None
        return cls(
            bucket=bucket,
            bitrate=int(os.environ.get("RECORDING_BITRATE", cls.bitrate)),
            flush_timeout_s=float(os.environ.get("RECORDING_FLUSH_TIMEOUT_S", cls.flush_timeout_s)),
        )


def _component(value: str) -> str:
    """キーとメタデータに入れる値。英数字と -_.~ 以外は %XX にする(/ も含む)。"""
    return quote(value, safe="") or "_"


def recording_key(room_id: str, started_at: datetime, utterance_id: str, speaker_id: str) -> str:
    """rooms/<room_id>/<YYYY>/<MM>/<DD>/<utterance_id>-<speaker_id>.ogg(日付は UTC)。

    utterance_id は 32文字の hex なので、ファイル名の先頭33文字までで分けられる。
    """
    day = started_at.astimezone(UTC).strftime("%Y/%m/%d")
    return (
        f"{KEY_PREFIX}{_component(room_id)}/{day}/"
        f"{_component(utterance_id)}-{_component(speaker_id)}.ogg"
    )


def recording_metadata(
    *,
    room_id: str,
    utterance_id: str,
    speaker_id: str,
    language: str | None,
    started_at: datetime,
    duration_s: float,
) -> dict[str, str]:
    """S3 のオブジェクトのメタデータ(x-amz-meta-*)。値は ASCII にする。"""
    return {
        "room-id": _component(room_id),
        "utterance-id": _component(utterance_id),
        "speaker-id": _component(speaker_id),
        "language": _component(language) if language else "",
        "started-at": format_time(started_at),
        "duration-s": f"{duration_s:.3f}",
    }


class OggOpusEncoder:
    """PCM16・モノラルを Ogg/Opus にして out に書く。スレッドから呼んでよい(1つずつ順に)。"""

    def __init__(self, out: IO[bytes], *, sample_rate: int = SAMPLE_RATE, bitrate: int = 24000):
        self._sample_rate = sample_rate
        self._container: Any = av.open(out, mode="w", format="ogg")
        stream: Any = self._container.add_stream("libopus", rate=sample_rate, layout="mono")
        stream.bit_rate = bitrate
        # 音声向けの調整(libopus の application=voip)
        stream.codec_context.options = {"application": "voip"}
        self._stream = stream
        self.samples = 0
        self._closed = False

    @property
    def duration_s(self) -> float:
        return self.samples / self._sample_rate

    def write(self, pcm: bytes) -> None:
        if not pcm:
            return
        data = np.frombuffer(pcm, dtype=np.int16).reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(data, format="s16", layout="mono")
        frame.sample_rate = self._sample_rate
        frame.pts = self.samples
        self.samples += data.shape[1]
        for packet in self._stream.encode(frame):
            self._container.mux(packet)

    def close(self) -> None:
        """残りを出し切って Ogg を閉じる。out は閉じない。"""
        if self._closed:
            return
        self._closed = True
        for packet in self._stream.encode(None):
            self._container.mux(packet)
        self._container.close()


class Uploader(Protocol):
    async def put(self, key: str, body: IO[bytes], metadata: dict[str, str]) -> None:
        """body を先頭から送る。失敗したら例外を投げる(再送は呼び出し側がする)。"""
        ...


class S3Uploader:
    """boto3 で S3 に置く。boto3 は同期なのでスレッドで動かす。

    接続先は AWS SDK の標準の環境変数で決まる(ローカルでは AWS_ENDPOINT_URL_S3 が SeaweedFS)。
    ECS ではタスクロールの認証情報を使う。
    """

    def __init__(self, bucket: str) -> None:
        self._bucket = bucket
        self._client: Any = None
        self._lock = threading.Lock()

    async def put(self, key: str, body: IO[bytes], metadata: dict[str, str]) -> None:
        await asyncio.to_thread(self._put, key, body, metadata)

    def _s3(self) -> Any:
        # クライアントは作るのに時間がかかる(サービスの定義を読む)ので、初めて使うときに1つだけ作る
        with self._lock:
            if self._client is None:
                import boto3
                from botocore.config import Config

                self._client = boto3.client(
                    "s3", config=Config(retries={"mode": "standard", "max_attempts": 3})
                )
            return self._client

    def _put(self, key: str, body: IO[bytes], metadata: dict[str, str]) -> None:
        from boto3.s3.transfer import TransferConfig

        body.seek(0)
        self._s3().upload_fileobj(
            body,
            self._bucket,
            key,
            ExtraArgs={"ContentType": CONTENT_TYPE, "Metadata": metadata},
            Config=TransferConfig(multipart_threshold=MULTIPART_THRESHOLD_BYTES),
        )


_END = object()


class Recording:
    """1つの発話の録音。push() で PCM を渡し、finish() で閉じる。

    呼び出しはイベントループの中から。
    """

    def __init__(
        self,
        recorder: Recorder,
        *,
        room_id: str,
        utterance_id: str,
        speaker_id: str,
        language: str | None,
        started_at: datetime,
    ) -> None:
        self._recorder = recorder
        self.room_id = room_id
        self.utterance_id = utterance_id
        self.speaker_id = speaker_id
        self.language = language
        self.started_at = started_at
        self.key = recording_key(room_id, started_at, utterance_id, speaker_id)
        self._buffer = bytearray()
        self._chunk_bytes = int(SAMPLE_RATE * ENCODE_CHUNK_S) * SAMPLE_WIDTH
        self._queue: asyncio.Queue[bytes | object] = asyncio.Queue()
        self.finished = False

    def push(self, pcm: bytes) -> None:
        """24kHz・PCM16・モノラル。"""
        if self.finished:
            return
        self._buffer += pcm
        if len(self._buffer) >= self._chunk_bytes:
            self._flush_buffer()

    def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self._flush_buffer()
        self._queue.put_nowait(_END)

    def _flush_buffer(self) -> None:
        if self._buffer:
            self._queue.put_nowait(bytes(self._buffer))
            self._buffer.clear()

    async def run(self) -> None:
        """エンコードし、発話が終わったら保存する。"""
        with tempfile.SpooledTemporaryFile(max_size=SPOOL_MAX_BYTES) as out:
            try:
                encoder = await asyncio.to_thread(
                    OggOpusEncoder, out, bitrate=self._recorder.bitrate
                )
                while (item := await self._queue.get()) is not _END:
                    assert isinstance(item, bytes)
                    await asyncio.to_thread(encoder.write, item)
                await asyncio.to_thread(encoder.close)
            except Exception:
                logger.exception("録音のエンコードに失敗した: %s", self.key)
                # この発話の残りの音声は受け取らない(キューにためない)
                self.finished = True
                return
            if encoder.samples == 0:
                # 音声が1フレームも届かなかった(すぐにミュートした、など)
                return
            metadata = recording_metadata(
                room_id=self.room_id,
                utterance_id=self.utterance_id,
                speaker_id=self.speaker_id,
                language=self.language,
                started_at=self.started_at,
                duration_s=encoder.duration_s,
            )
            await self._recorder.upload(self.key, out, metadata)


class _NullRecording:
    """録音しないとき(設定が無いとき)の代わり。"""

    def push(self, pcm: bytes) -> None:
        pass

    def finish(self) -> None:
        pass


class Recorder:
    """ルーム(ジョブ)ごとに1つ。発話ごとの Recording を作り、送り終わるのを見届ける。

    uploader が None なら何もしない(設定が無いとき)。
    """

    def __init__(
        self,
        uploader: Uploader | None,
        room_name: Callable[[], str],
        *,
        bitrate: int = 24000,
        max_attempts: int = 3,
        retry_base_s: float = 1.0,
        flush_timeout_s: float = 5.0,
    ) -> None:
        self._uploader = uploader
        # ルーム名は接続してから決まるので、録音を始めるときに読む
        self._room_name = room_name
        self.bitrate = bitrate
        self._max_attempts = max_attempts
        self._retry_base_s = retry_base_s
        self._flush_timeout_s = flush_timeout_s
        self._recordings: set[Recording] = set()
        self._tasks: set[asyncio.Task[None]] = set()
        self._closed = False

    @property
    def enabled(self) -> bool:
        return self._uploader is not None

    def start(
        self,
        *,
        utterance_id: str,
        speaker_id: str,
        language: str | None,
        started_at: datetime,
    ) -> Recording | _NullRecording:
        if self._uploader is None or self._closed:
            return _NullRecording()
        recording = Recording(
            self,
            room_id=self._room_name(),
            utterance_id=utterance_id,
            speaker_id=speaker_id,
            language=language,
            started_at=started_at,
        )
        self._recordings.add(recording)
        task = asyncio.create_task(recording.run())
        self._tasks.add(task)

        def done(t: asyncio.Task[None]) -> None:
            self._tasks.discard(t)
            self._recordings.discard(recording)

        task.add_done_callback(done)
        return recording

    async def upload(self, key: str, body: IO[bytes], metadata: dict[str, str]) -> bool:
        """再送つきで保存する。保存できたら True。"""
        assert self._uploader is not None
        for attempt in range(1, self._max_attempts + 1):
            try:
                await self._uploader.put(key, body, metadata)
            except Exception as e:
                if attempt >= self._max_attempts:
                    logger.error(
                        "録音を保存できなかった(%d回試した。最後は %r): %s", attempt, e, key
                    )
                    return False
                delay = self._retry_base_s * 2 ** (attempt - 1)
                logger.warning("録音の保存に失敗した(%r)。%.1f秒後に再送する: %s", e, delay, key)
                await asyncio.sleep(delay)
            else:
                logger.info("録音を保存した: %s(%s秒)", key, metadata.get("duration-s"))
                return True
        return False

    async def aclose(self) -> None:
        """終わっていない録音を閉じ、送り中のものを flush_timeout_s まで待つ。"""
        if self._closed:
            return
        self._closed = True
        for recording in list(self._recordings):
            recording.finish()
        if not self._tasks:
            return
        _, pending = await asyncio.wait(self._tasks, timeout=self._flush_timeout_s)
        if pending:
            logger.warning("ジョブの終わりまでに送れなかった録音を捨てた: %d件", len(pending))
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)


def create_recorder(room_name: Callable[[], str]) -> Recorder:
    """環境変数の設定で Recorder を作る。設定が無ければ何もしないものを返す。"""
    settings = RecordingSettings.from_env()
    if settings is None:
        return Recorder(None, room_name)
    return Recorder(
        S3Uploader(settings.bucket),
        room_name,
        bitrate=settings.bitrate,
        max_attempts=settings.max_attempts,
        retry_base_s=settings.retry_base_s,
        flush_timeout_s=settings.flush_timeout_s,
    )
