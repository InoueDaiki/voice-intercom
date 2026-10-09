"""翻訳と文字起こしの遅延を測る PoC スクリプト(LiveKit を使わない)。

WAV ファイルを実時間のペースで OpenAI に流し、次を記録する。

- gpt-realtime-translate: 翻訳先の言語ごとに1セッション。翻訳音声と翻訳テキスト
- gpt-realtime-whisper: 原文の文字起こし(話者ごとに1本、という設計に合わせて別セッション)

使い方は poc/README.md を参照する。
"""

import argparse
import asyncio
import base64
import json
import os
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp
import numpy as np
from livekit import rtc

SAMPLE_RATE = 24000
# 翻訳音声のサンプルレート。公式に記載がなく、実測(200ms ごとに 19200 バイト)で 48kHz と判断した
OUTPUT_SAMPLE_RATE = 48000
CHUNK_MS = 100
CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_MS // 1000

TRANSLATE_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"
# 公式ドキュメントに whisper の接続先が明記されていないため、Realtime の文字起こし用の URL を使う。
# 動かなければ --whisper-url で差し替える
WHISPER_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
WHISPER_MODEL = "gpt-realtime-whisper"

# 発話の開始を判定する振幅の閾値(PCM16 の RMS)
SPEECH_RMS = 500
# 翻訳音声の無音はほぼ 0 なので、低い閾値で有声と判定する
OUTPUT_VOICE_RMS = 50


def load_pcm24k(path: Path) -> np.ndarray:
    """WAV を読み、24kHz・モノラル・int16 にする。"""
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise SystemExit(f"{path}: 16bit の WAV にしてください")
        rate = w.getframerate()
        channels = w.getnchannels()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1).astype(np.int16)
    if rate == SAMPLE_RATE:
        return data
    resampler = rtc.AudioResampler(rate, SAMPLE_RATE)
    frames = resampler.push(bytearray(data.tobytes()))
    frames += resampler.flush()
    return np.concatenate([np.frombuffer(f.data, dtype=np.int16) for f in frames])


def silence(ms: int) -> np.ndarray:
    return np.zeros(SAMPLE_RATE * ms // 1000, dtype=np.int16)


def is_voiced(pcm: np.ndarray) -> bool:
    return len(pcm) > 0 and float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) > OUTPUT_VOICE_RMS


def first_speech_ms(pcm: np.ndarray) -> float:
    """入力の中で最初に発話が始まる時刻(ms)を、チャンクごとの RMS で推定する。"""
    for i in range(0, len(pcm), CHUNK_SAMPLES // 5):
        chunk = pcm[i : i + CHUNK_SAMPLES // 5].astype(np.float64)
        if len(chunk) and np.sqrt(np.mean(chunk**2)) > SPEECH_RMS:
            return i * 1000 / SAMPLE_RATE
    return 0.0


@dataclass
class Session:
    """1本の WebSocket セッションの記録。"""

    name: str
    events: list[dict] = field(default_factory=list)
    text: list[str] = field(default_factory=list)
    audio: bytearray = field(default_factory=bytearray)
    first_audio_ms: float | None = None
    # 翻訳音声は無音を含めて流れ続けるため、無音でないチャンクの最初と最後を別に記録する
    first_voice_ms: float | None = None
    last_voice_ms: float | None = None
    first_text_ms: float | None = None
    closed_ms: float | None = None
    errors: list[dict] = field(default_factory=list)


class Clock:
    def __init__(self) -> None:
        self.t0 = time.monotonic()

    def ms(self) -> float:
        return (time.monotonic() - self.t0) * 1000


async def stream_audio(
    ws: aiohttp.ClientWebSocketResponse,
    pcm: np.ndarray,
    append_type: str,
    start: asyncio.Event,
) -> None:
    """100ms ずつ実時間のペースで送る。"""
    await start.wait()
    t0 = time.monotonic()
    for n, i in enumerate(range(0, len(pcm), CHUNK_SAMPLES)):
        chunk = pcm[i : i + CHUNK_SAMPLES].tobytes()
        await ws.send_json({"type": append_type, "audio": base64.b64encode(chunk).decode()})
        delay = t0 + (n + 1) * CHUNK_MS / 1000 - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)


async def wait_updated(ws: aiohttp.ClientWebSocketResponse, s: Session, clock: Clock) -> None:
    """session.update が反映されるまで待つ。反映前に送った音声は、既定の設定で処理されうる。"""
    async for msg in ws:
        if msg.type != aiohttp.WSMsgType.TEXT:
            break
        ev = json.loads(msg.data)
        s.events.append({"t": clock.ms(), **ev})
        if ev.get("type") == "error":
            s.errors.append(ev)
            return
        if ev.get("type") == "session.updated":
            return


async def run_translate(
    http: aiohttp.ClientSession,
    headers: dict[str, str],
    lang: str,
    pcm: np.ndarray,
    args: argparse.Namespace,
    clock: Clock,
    ready: asyncio.Barrier,
    start: asyncio.Event,
) -> Session:
    s = Session(f"translate-{lang}")
    audio_input: dict = {
        "noise_reduction": None
        if args.noise_reduction == "none"
        else {"type": args.noise_reduction}
    }
    if args.inline_transcription:
        audio_input["transcription"] = {"model": WHISPER_MODEL}
    async with http.ws_connect(TRANSLATE_URL, headers=headers) as ws:
        await ws.send_json(
            {
                "type": "session.update",
                "session": {"audio": {"input": audio_input, "output": {"language": lang}}},
            }
        )
        if not args.no_wait_updated:
            await wait_updated(ws, s, clock)
        await ready.wait()

        async def send_then_close() -> None:
            # --repeat 回送り、そのたびに --idle-s 秒は何も送らずに待ってから session.close を送る
            for n in range(args.repeat):
                s.events.append({"t": clock.ms(), "type": f"(client) 送信開始 #{n + 1}"})
                await stream_audio(ws, pcm, "session.input_audio_buffer.append", start)
                s.events.append({"t": clock.ms(), "type": f"(client) 送信終了 #{n + 1}"})
                if args.idle_s:
                    await asyncio.sleep(args.idle_s)
            await ws.send_json({"type": "session.close"})
            s.events.append({"t": clock.ms(), "type": "(client) session.close"})

        closer = asyncio.create_task(send_then_close())
        limit = (len(pcm) / SAMPLE_RATE + args.idle_s) * args.repeat + args.timeout
        try:
            async with asyncio.timeout(limit):
                async for msg in ws:
                    if msg.type != aiohttp.WSMsgType.TEXT:
                        break
                    ev = json.loads(msg.data)
                    t = clock.ms()
                    typ = ev.get("type", "")
                    if typ == "session.output_audio.delta":
                        chunk = base64.b64decode(ev["delta"])
                        s.audio += chunk
                        if s.first_audio_ms is None:
                            s.first_audio_ms = t
                        voiced = is_voiced(np.frombuffer(chunk, dtype=np.int16))
                        if voiced:
                            s.last_voice_ms = t
                            if s.first_voice_ms is None:
                                s.first_voice_ms = t
                        # 音声の中身はログに残さない
                        s.events.append(
                            {"t": t, "type": typ, "bytes": len(chunk), "voiced": voiced}
                        )
                        continue
                    if typ == "session.output_transcript.delta":
                        s.text.append(ev.get("delta", ""))
                        if s.first_text_ms is None:
                            s.first_text_ms = t
                    if typ == "error":
                        s.errors.append(ev)
                    s.events.append({"t": t, **ev})
                    if typ == "session.closed":
                        s.closed_ms = t
                        break
        except TimeoutError:
            s.errors.append({"type": "(client) timeout"})
        if s.closed_ms is None and ws.closed:
            # サーバーから切断された(アイドルタイムアウトなど)
            ev = {"t": clock.ms(), "type": "(server) 切断", "close_code": ws.close_code}
            s.events.append(ev)
            s.errors.append(ev)
        closer.cancel()
    return s


async def run_whisper(
    http: aiohttp.ClientSession,
    headers: dict[str, str],
    pcm: np.ndarray,
    args: argparse.Namespace,
    clock: Clock,
    ready: asyncio.Barrier,
    start: asyncio.Event,
) -> Session:
    s = Session("whisper")
    transcription: dict = {"model": WHISPER_MODEL}
    if args.source_lang:
        transcription["language"] = args.source_lang
    async with http.ws_connect(args.whisper_url, headers=headers) as ws:
        await ws.send_json(
            {
                "type": "session.update",
                "session": {
                    "type": "transcription",
                    "audio": {
                        "input": {
                            "format": {"type": "audio/pcm", "rate": SAMPLE_RATE},
                            "transcription": transcription,
                            "turn_detection": None,
                        }
                    },
                },
            }
        )
        if not args.no_wait_updated:
            await wait_updated(ws, s, clock)
        await ready.wait()
        sender = asyncio.create_task(stream_audio(ws, pcm, "input_audio_buffer.append", start))

        async def commit_after_send() -> None:
            await sender
            # PTT を離したときに相当する。turn_detection を切っているので手動で確定させる
            await ws.send_json({"type": "input_audio_buffer.commit"})
            s.events.append({"t": clock.ms(), "type": "(client) input_audio_buffer.commit"})

        committer = asyncio.create_task(commit_after_send())
        try:
            async with asyncio.timeout(len(pcm) / SAMPLE_RATE + args.timeout):
                async for msg in ws:
                    if msg.type != aiohttp.WSMsgType.TEXT:
                        break
                    ev = json.loads(msg.data)
                    t = clock.ms()
                    typ = ev.get("type", "")
                    if typ == "conversation.item.input_audio_transcription.delta":
                        s.text.append(ev.get("delta", ""))
                        if s.first_text_ms is None:
                            s.first_text_ms = t
                    if typ == "error":
                        s.errors.append(ev)
                    s.events.append({"t": t, **ev})
                    if typ == "conversation.item.input_audio_transcription.completed":
                        s.closed_ms = t
                        break
        except TimeoutError:
            s.errors.append({"type": "(client) timeout"})
        sender.cancel()
        committer.cancel()
    return s


def voiced_spans(events: list[dict]) -> list[tuple[float, float]]:
    """有声のチャンクが届いた時刻を、送信開始からの区間(秒)にまとめる。1秒以上空いたら区切る。"""
    spans: list[tuple[float, float]] = []
    for e in events:
        if not e.get("voiced"):
            continue
        t = round(e["t"] / 1000, 1)
        if spans and t - spans[-1][1] <= 1.0:
            spans[-1] = (spans[-1][0], t)
        else:
            spans.append((t, t))
    return spans


def write_wav(path: Path, pcm: bytes, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument(
        "wav", type=Path, help="入力の WAV(16bit。サンプルレートとチャンネル数は問わない)"
    )
    p.add_argument("--to", default="en", help="翻訳先の言語。カンマ区切りで複数(例: en,ko)")
    p.add_argument("--source-lang", help="whisper に渡す原文の言語(例: ja)。省略すると自動")
    p.add_argument(
        "--noise-reduction",
        choices=["near_field", "far_field", "none"],
        # API の既定(null)に合わせる。near_field は小さい声を消すことがあった(2026-10-09)
        default="none",
    )
    p.add_argument("--head-silence-ms", type=int, default=0, help="先頭に足す無音")
    p.add_argument(
        "--tail-silence-ms",
        type=int,
        default=0,
        help="末尾に足す無音。session.close の前に送り、末尾の欠けが減るかを見る",
    )
    p.add_argument("--no-whisper", action="store_true", help="whisper のセッションを作らない")
    p.add_argument(
        "--inline-transcription",
        action="store_true",
        help="翻訳セッションでも原文の文字起こしを有効にする(別セッションとの比較用)",
    )
    p.add_argument(
        "--repeat", type=int, default=1, help="同じセッションで入力を繰り返し送る回数(翻訳のみ)"
    )
    p.add_argument(
        "--idle-s",
        type=float,
        default=0,
        help="送り終えるたびに何も送らずに待つ秒数(翻訳のみ)。最後の待ちの後に close を送る",
    )
    p.add_argument(
        "--no-wait-updated",
        action="store_true",
        help="session.updated を待たずに音声を送り始める(修正前の動作。比較用)",
    )
    p.add_argument("--whisper-url", default=WHISPER_URL)
    p.add_argument("--timeout", type=float, default=60, help="送信後に待つ秒数の上限")
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    args = p.parse_args()
    if (args.repeat > 1 or args.idle_s) and not args.no_whisper:
        raise SystemExit("--repeat と --idle-s は翻訳だけで使う。--no-whisper を付ける")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY が空です。.env に設定してください")
    headers = {"Authorization": f"Bearer {api_key}"}

    speech = load_pcm24k(args.wav)
    pcm = np.concatenate([silence(args.head_silence_ms), speech, silence(args.tail_silence_ms)])
    speech_start = args.head_silence_ms + first_speech_ms(speech)
    speech_end = args.head_silence_ms + len(speech) * 1000 / SAMPLE_RATE
    langs = [lang.strip() for lang in args.to.split(",") if lang.strip()]

    clock = Clock()
    start = asyncio.Event()
    # すべてのセッションの接続と設定が終わってから、同時に送り始める
    ready = asyncio.Barrier(len(langs) + (0 if args.no_whisper else 1) + 1)
    async with aiohttp.ClientSession() as http:
        tasks = [
            asyncio.create_task(run_translate(http, headers, lang, pcm, args, clock, ready, start))
            for lang in langs
        ]
        if not args.no_whisper:
            tasks.append(
                asyncio.create_task(run_whisper(http, headers, pcm, args, clock, ready, start))
            )
        try:
            async with asyncio.timeout(30):
                await ready.wait()
        except TimeoutError:
            # 接続や設定に失敗したセッションがあると揃わない
            for t in tasks:
                if t.done() and t.exception():
                    print(f"接続に失敗: {t.exception()!r}")
            raise SystemExit("30秒以内にすべてのセッションの準備が終わりませんでした") from None
        clock.t0 = time.monotonic()
        start.set()
        sessions: list[Session] = await asyncio.gather(*tasks)

    run_dir = args.out / f"{time.strftime('%Y%m%d-%H%M%S')}-{args.wav.stem}"
    run_dir.mkdir(parents=True, exist_ok=True)
    summary: dict = {
        "input": str(args.wav),
        "args": {k: str(v) for k, v in vars(args).items()},
        "speech_start_s": speech_start / 1000,
        "speech_end_s": speech_end / 1000,
        "sessions": {},
    }

    def rel(ms: float | None, base: float) -> float | None:
        return None if ms is None else round((ms - base) / 1000, 2)

    print(f"\n入力: {args.wav}  発話 {speech_start / 1000:.2f}s〜{speech_end / 1000:.2f}s")
    print("初回の字・初回の声は発話の開始から、最後の声・終了は発話の終了からの経過\n")
    print(f"{'セッション':<14}{'初回の字':>8}{'初回の声':>8}{'最後の声':>8}{'終了':>10}{'有声':>8}")
    for s in sessions:
        voiced_s = sum(1 for e in s.events if e.get("voiced")) * 0.2  # 1チャンク = 200ms(実測)
        row = {
            "first_text_s": rel(s.first_text_ms, speech_start),
            "first_voice_s": rel(s.first_voice_ms, speech_start),
            "last_voice_s": rel(s.last_voice_ms, speech_end),
            "close_s": rel(s.closed_ms, speech_end),
            "voiced_s": round(voiced_s, 1),
            "output_audio_s": round(len(s.audio) / 2 / OUTPUT_SAMPLE_RATE, 2),
            "text": "".join(s.text),
            "errors": s.errors,
        }
        cells = [row["first_text_s"], row["first_voice_s"], row["last_voice_s"], row["close_s"]]
        print(
            f"{s.name:<18}"
            + "".join("       -" if v is None else f"{v:7.2f}s" for v in cells)
            + ("       -" if not s.first_voice_ms else f"{voiced_s:7.1f}s")
        )
        print(f"  テキスト: {row['text']}")
        spans = voiced_spans(s.events)
        if spans:
            row["voiced_spans_s"] = spans
            print("  有声区間: " + ", ".join(f"{a:.1f}〜{b:.1f}s" for a, b in spans))
        for e in s.errors:
            print(f"  エラー: {json.dumps(e, ensure_ascii=False)}")
        with (run_dir / f"{s.name}.jsonl").open("w") as f:
            for e in s.events:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        if s.audio:
            write_wav(run_dir / f"{s.name}.wav", bytes(s.audio), OUTPUT_SAMPLE_RATE)
        summary["sessions"][s.name] = row
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n保存先: {run_dir}")


if __name__ == "__main__":
    asyncio.run(main())
