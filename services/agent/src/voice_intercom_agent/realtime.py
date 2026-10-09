"""OpenAI の Realtime のセッション(翻訳と文字起こし)。1つの発話ごとに作って捨てる。

PoC(poc/translate_bench.py)で分かった手順に従う。

- session.update を送ったら、session.updated を待ってから音声を送る。
  待つ間に届いた音声はキューにためておき、そろってから送る(発話の頭を欠かさない)。
- ノイズ低減は無効にする(near_field は小さい声を消した)。
- 翻訳は、発話が終わったらすぐ session.close を送り、session.closed まで受信を続ける。
  出力は入力が届くのに合わせてしか進まないので、時間を置いてから close すると翻訳音声が捨てられる。
- whisper は turn_detection を null にして、発話の終わりに input_audio_buffer.commit を送る。
"""

import asyncio
import base64
import json
import logging
from collections.abc import Callable
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

# 入力は 24kHz・PCM16・モノラル
INPUT_SAMPLE_RATE = 24000
# 翻訳音声の出力は 48kHz・PCM16・モノラル(公式に記載がなく、PoC の実測で判断)
OUTPUT_SAMPLE_RATE = 48000

TRANSLATE_URL = "wss://api.openai.com/v1/realtime/translations?model={model}"
# whisper の接続先は公式に明記がない。PoC で動作を確かめた URL
WHISPER_URL = "wss://api.openai.com/v1/realtime?intent=transcription"

# session.updated を待つ上限
READY_TIMEOUT_S = 10.0

_END = object()


class RealtimeSession:
    """送信と受信を別のタスクで回す。push() で音声を渡し、finish() で発話を終える。"""

    name: str

    def __init__(self, http: aiohttp.ClientSession, api_key: str) -> None:
        self._http = http
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._queue: asyncio.Queue[bytes | object] = asyncio.Queue()
        self._finished = asyncio.Event()

    def push(self, pcm: bytes) -> None:
        """24kHz・PCM16・モノラルの音声。接続前でも渡してよい。"""
        if not self._finished.is_set():
            self._queue.put_nowait(pcm)

    def finish(self) -> None:
        if not self._finished.is_set():
            self._finished.set()
            self._queue.put_nowait(_END)

    async def run(self) -> None:
        try:
            async with self._http.ws_connect(self._url(), headers=self._headers) as ws:
                await ws.send_json({"type": "session.update", "session": self._session_config()})
                async with asyncio.timeout(READY_TIMEOUT_S):
                    await self._wait_updated(ws)
                sender = asyncio.create_task(self._send(ws))
                try:
                    await self._receive(ws)
                finally:
                    sender.cancel()
        except Exception:
            logger.exception("%s: セッションが異常終了した", self.name)
        finally:
            self._on_done()

    async def _wait_updated(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        async for msg in ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                break
            ev = json.loads(msg.data)
            if ev.get("type") == "session.updated":
                return
            if ev.get("type") == "error":
                raise RuntimeError(f"session.update が失敗した: {ev}")
        raise RuntimeError("session.updated の前に切断された")

    async def _send(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        while True:
            item = await self._queue.get()
            if item is _END:
                await self._send_end(ws)
                return
            assert isinstance(item, bytes)
            audio = base64.b64encode(item).decode()
            await ws.send_json({"type": self._append_type(), "audio": audio})

    async def _receive(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        # 発話が終わってからは、上限の時間までに終わらなければ打ち切る
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout(None) as deadline:

                def on_finished(task: asyncio.Task[Any]) -> None:
                    if not task.cancelled():
                        deadline.reschedule(loop.time() + self._end_timeout_s())

                ended = asyncio.create_task(self._finished.wait())
                ended.add_done_callback(on_finished)
                try:
                    async for msg in ws:
                        if msg.type != aiohttp.WSMsgType.TEXT:
                            break
                        ev = json.loads(msg.data)
                        if ev.get("type") == "error":
                            logger.warning("%s: %s", self.name, ev)
                        if self._handle(ev):
                            return
                finally:
                    ended.cancel()
        except TimeoutError:
            logger.warning(
                "%s: 発話の終了から %.0f秒たっても終わらないので打ち切った",
                self.name,
                self._end_timeout_s(),
            )
            return
        logger.warning("%s: 終了を待たずに切断された(close code %s)", self.name, ws.close_code)

    # --- サブクラスで実装する ---

    def _url(self) -> str:
        raise NotImplementedError

    def _session_config(self) -> dict[str, Any]:
        raise NotImplementedError

    def _append_type(self) -> str:
        raise NotImplementedError

    async def _send_end(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        raise NotImplementedError

    def _end_timeout_s(self) -> float:
        raise NotImplementedError

    def _handle(self, ev: dict[str, Any]) -> bool:
        """イベントを1つ処理する。セッションを終えるなら True。"""
        raise NotImplementedError

    def _on_done(self) -> None:
        pass


class TranslateSession(RealtimeSession):
    """gpt-realtime-translate。翻訳音声を on_audio に渡す。翻訳テキストはログに残すだけ。"""

    def __init__(
        self,
        http: aiohttp.ClientSession,
        api_key: str,
        *,
        model: str,
        language: str,
        close_timeout_s: float,
        on_audio: Callable[[bytes], None],
        on_done: Callable[[], None],
    ) -> None:
        super().__init__(http, api_key)
        self.name = f"translate-{language}"
        self._model = model
        self._language = language
        self._close_timeout_s = close_timeout_s
        self._on_audio = on_audio
        self._on_done_cb = on_done
        self._transcript: list[str] = []

    def _url(self) -> str:
        return TRANSLATE_URL.format(model=self._model)

    def _session_config(self) -> dict[str, Any]:
        return {
            "audio": {
                "input": {"noise_reduction": None},
                "output": {"language": self._language},
            }
        }

    def _append_type(self) -> str:
        return "session.input_audio_buffer.append"

    async def _send_end(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        await ws.send_json({"type": "session.close"})

    def _end_timeout_s(self) -> float:
        return self._close_timeout_s

    def _handle(self, ev: dict[str, Any]) -> bool:
        match ev.get("type"):
            case "session.output_audio.delta":
                self._on_audio(base64.b64decode(ev["delta"]))
            case "session.output_transcript.delta":
                self._transcript.append(ev.get("delta", ""))
            case "session.closed":
                # 字幕には使わない(構成 B)。比較のためにログに残す
                logger.info("%s: STS の翻訳テキスト: %s", self.name, "".join(self._transcript))
                return True
        return False

    def _on_done(self) -> None:
        self._on_done_cb()


class WhisperSession(RealtimeSession):
    """gpt-realtime-whisper。原文の断片を on_delta、確定した全文を on_completed に渡す。"""

    name = "whisper"

    def __init__(
        self,
        http: aiohttp.ClientSession,
        api_key: str,
        *,
        model: str,
        language: str | None,
        commit_timeout_s: float,
        on_delta: Callable[[str], None],
        on_completed: Callable[[str], None],
    ) -> None:
        super().__init__(http, api_key)
        self._model = model
        self._language = language
        self._commit_timeout_s = commit_timeout_s
        self._on_delta = on_delta
        self._on_completed = on_completed
        self._completed = False

    def _url(self) -> str:
        return WHISPER_URL

    def _session_config(self) -> dict[str, Any]:
        transcription: dict[str, Any] = {"model": self._model}
        if self._language:
            transcription["language"] = self._language
        return {
            "type": "transcription",
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": INPUT_SAMPLE_RATE},
                    "transcription": transcription,
                    "turn_detection": None,
                    "noise_reduction": None,
                }
            },
        }

    def _append_type(self) -> str:
        return "input_audio_buffer.append"

    async def _send_end(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        await ws.send_json({"type": "input_audio_buffer.commit"})

    def _end_timeout_s(self) -> float:
        return self._commit_timeout_s

    def _handle(self, ev: dict[str, Any]) -> bool:
        match ev.get("type"):
            case "conversation.item.input_audio_transcription.delta":
                self._on_delta(ev.get("delta", ""))
            case "conversation.item.input_audio_transcription.completed":
                self._completed = True
                self._on_completed(ev.get("transcript", ""))
                return True
            case "error" if self._finished.is_set():
                # 短すぎる発話の commit などは確定できない。空の全文で終える
                return True
        return False

    def _on_done(self) -> None:
        if not self._completed:
            self._completed = True
            self._on_completed("")
