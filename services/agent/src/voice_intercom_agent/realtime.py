"""OpenAI の Realtime のセッション(翻訳と文字起こし)。1つの発話ごとに作って捨てる。

PoC(poc/translate_bench.py)で分かった手順に従う。

- session.update を送ったら、session.updated を待ってから音声を送る。
  待つ間に届いた音声はキューにためておき、そろってから送る(発話の頭を欠かさない)。
- ノイズ低減は無効にする(near_field は小さい声を消した)。
- 翻訳は、発話が終わったらすぐ session.close を送り、session.closed まで受信を続ける。
  出力は入力が届くのに合わせてしか進まないので、時間を置いてから close すると翻訳音声が捨てられる。
  close の前に短い無音(tail_silence_s)を送れる。最後の文の翻訳が欠けるのを防ぐ案だが、効果を
  確かめられず、無音も課金されるので、既定では送らない(設計メモの「Agent の見直し」)。
- whisper は turn_detection を null にして、発話の終わりに input_audio_buffer.commit を送る。
  gpt-realtime-whisper は自動区切りに対応していない(公式の決まり)。長い発話は、Agent が
  区切り(segmenter.py)を決めて、発話の途中でも commit を送る。
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

# 末尾の無音を送る単位(100ms)
TAIL_SILENCE_CHUNK = b"\x00\x00" * (INPUT_SAMPLE_RATE // 10)

# session.updated を待つ上限
READY_TIMEOUT_S = 10.0

_END = object()
# WhisperSession.split() の目印
_SPLIT = object()


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
            if item is _SPLIT:
                await self._send_split(ws)
                continue
            assert isinstance(item, bytes)
            audio = base64.b64encode(item).decode()
            await ws.send_json({"type": self._append_type(), "audio": audio})
            self._on_append()

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

    async def _send_split(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        pass

    def _on_append(self) -> None:
        pass

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
        tail_silence_s: float,
        on_audio: Callable[[bytes], None],
        on_done: Callable[[], None],
    ) -> None:
        super().__init__(http, api_key)
        self.name = f"translate-{language}"
        self._model = model
        self._language = language
        self._close_timeout_s = close_timeout_s
        self._tail_silence_s = tail_silence_s
        # 音声を1つでも送ったか(送っていなければ、末尾の無音も送らない)
        self._appended = False
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

    def _on_append(self) -> None:
        self._appended = True

    async def _send_end(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        if self._appended:
            # 待たずにまとめて送る。PTT を離してから close までを延ばさない
            chunks = round(self._tail_silence_s * 10)
            audio = base64.b64encode(TAIL_SILENCE_CHUNK).decode()
            for _ in range(chunks):
                await ws.send_json({"type": self._append_type(), "audio": audio})
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
    """gpt-realtime-whisper。原文の断片を on_delta、確定した全文を on_completed に渡す。

    split() で発話の途中に区切りを作れる(input_audio_buffer.commit を送り、続きの音声は次の
    区切りになる)。区切りには先頭から 0, 1, 2... と番号を振り、コールバックには番号も渡す。
    確定は区切りごとに1回ずつ、必ず呼ぶ(確定できなければ空の全文で呼ぶ)。

    書き起こしのイベントの item_id は、commit ごとに作られる会話のアイテムの ID。アイテムは
    commit の順に作られるので、初めて見た item_id に、まだ結び付けていない最も若い番号を結ぶ。
    """

    name = "whisper"

    def __init__(
        self,
        http: aiohttp.ClientSession,
        api_key: str,
        *,
        model: str,
        language: str | None,
        commit_timeout_s: float,
        on_delta: Callable[[int, str], None],
        on_completed: Callable[[int, str], None],
    ) -> None:
        super().__init__(http, api_key)
        self._model = model
        self._language = language
        self._commit_timeout_s = commit_timeout_s
        self._on_delta = on_delta
        self._on_completed = on_completed
        # 送信側で、いま音声を送っている区切りの番号
        self._open = 0
        # 前の commit の後に音声を送ったか
        self._appended = False
        # 最後の commit(発話の終わり)を送ったか
        self._end_sent = False
        # item_id と区切りの番号の対応。アイテムができない区切り(音声が無いなど)は _no_item に入れる
        self._items: dict[str, int] = {}
        self._next_item = 0
        self._no_item: set[int] = set()
        # commit の event_id と区切りの番号(error の event_id から、失敗した区切りを探す)
        self._commits: dict[str, int] = {}
        self._completed: set[int] = set()

    def split(self) -> None:
        """ここまでの音声で区切りを確定させる。push() と同じ順番で送る。"""
        if not self._finished.is_set():
            self._queue.put_nowait(_SPLIT)

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
                    # gpt-realtime-whisper は自動区切り(VAD)に対応していない。null にする決まり
                    "turn_detection": None,
                    "noise_reduction": None,
                }
            },
        }

    def _append_type(self) -> str:
        return "input_audio_buffer.append"

    def _on_append(self) -> None:
        self._appended = True

    async def _send_split(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        index = self._open
        self._open += 1
        if not self._appended:
            # 空のバッファは commit できない。アイテムができないので、空の全文で確定する
            self._skip_item(index)
            self._complete(index, "")
            return
        await self._commit(ws, index)

    async def _send_end(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        # 音声が無くても送る(従来どおり、失敗したら error で終える)
        index = self._open
        self._end_sent = True
        await self._commit(ws, index)

    async def _commit(self, ws: aiohttp.ClientWebSocketResponse, index: int) -> None:
        event_id = f"commit-{index}"
        self._commits[event_id] = index
        self._appended = False
        await ws.send_json({"type": "input_audio_buffer.commit", "event_id": event_id})

    def _end_timeout_s(self) -> float:
        return self._commit_timeout_s

    def _handle(self, ev: dict[str, Any]) -> bool:
        if item_id := ev.get("item_id"):
            # 区切りと item_id の対応を確かめるため(--log-level debug で出る)
            logger.debug(
                "%s: %s item=%s → #%d %r",
                self.name,
                ev.get("type"),
                item_id,
                self._items.get(item_id, -1),
                ev.get("delta") or ev.get("transcript") or "",
            )
        match ev.get("type"):
            case "conversation.item.input_audio_transcription.delta":
                index = self._index(ev.get("item_id"))
                if index not in self._completed:
                    self._on_delta(index, ev.get("delta", ""))
            case "input_audio_buffer.committed":
                self._index(ev.get("item_id"))
            case "conversation.item.input_audio_transcription.completed":
                self._complete(self._index(ev.get("item_id")), ev.get("transcript", ""))
            case "error":
                event_id = (ev.get("error") or {}).get("event_id")
                index = self._commits.get(event_id) if event_id else None
                if index is not None:
                    # 短すぎる区切りの commit などは確定できない。空の全文で確定する
                    self._skip_item(index)
                    self._complete(index, "")
                elif self._end_sent:
                    # どの commit の失敗か分からない。最後の commit の失敗とみなして空で確定する
                    self._complete(self._open, "")
        return self._end_sent and all(i in self._completed for i in range(self._open + 1))

    def _index(self, item_id: str | None) -> int:
        """item_id の区切りの番号。item_id が無ければ、いま音声を送っている区切りとみなす。"""
        if not item_id:
            return self._open
        index = self._items.get(item_id)
        if index is None:
            index = self._items[item_id] = self._next_item
            self._next_item += 1
            self._advance_next_item()
        return index

    def _skip_item(self, index: int) -> None:
        if index not in self._items.values():
            self._no_item.add(index)
            self._advance_next_item()

    def _advance_next_item(self) -> None:
        while self._next_item in self._no_item:
            self._next_item += 1

    def _complete(self, index: int, text: str) -> None:
        if index not in self._completed:
            self._completed.add(index)
            self._on_completed(index, text)

    def _on_done(self) -> None:
        # 確定していない区切りを、空の全文で確定する(断片を出していれば字幕が消える)
        for index in range(self._open + 1):
            self._complete(index, "")
