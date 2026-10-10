"""聞き手としてルームに入り、自分の言語の翻訳音声と字幕を確かめる。

- 翻訳音声のトラック(translation-<言語>)だけを購読し、WAV に保存する。テキスト入力の
  読み上げも、このトラックに流れる
- データチャネルの字幕(Caption)をデコードして表示する

使い方は services/agent/README.md を参照する。
"""

import argparse
import asyncio
import signal
import sys
import time
import wave
from pathlib import Path

import numpy as np
from common import add_connection_args, make_token
from livekit import rtc

from voice_intercom_agent.captions import CAPTION_TOPIC
from voice_intercom_agent.output import translation_track_name
from voiceintercom.v1.caption_pb2 import Caption

OUT_DIR = Path(__file__).parent / "out"
SAMPLE_RATE = 48000
# 翻訳音声の無音はほぼ 0 なので、低い閾値で有声と判定する(PoC と同じ)
VOICE_RMS = 50


class Clock:
    def __init__(self) -> None:
        self.t0 = time.monotonic()

    def stamp(self) -> str:
        return f"[{time.monotonic() - self.t0:7.2f}s]"


async def record(track: rtc.Track, path: Path, clock: Clock) -> None:
    """翻訳音声を WAV に書き、有声の区間の始まりと終わりを表示する。"""
    stream = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=1)
    voiced = False
    quiet_ms = 0
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        async for ev in stream:
            pcm = np.frombuffer(ev.frame.data, dtype=np.int16)
            w.writeframes(pcm.tobytes())
            rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) if len(pcm) else 0.0
            frame_ms = len(pcm) * 1000 // SAMPLE_RATE
            if rms > VOICE_RMS:
                quiet_ms = 0
                if not voiced:
                    voiced = True
                    print(f"{clock.stamp()} 翻訳音声: 流れ始めた")
            elif voiced:
                quiet_ms += frame_ms
                # 1秒続けて無音なら、ひと区切りとみなす
                if quiet_ms >= 1000:
                    voiced = False
                    print(f"{clock.stamp()} 翻訳音声: 止まった")


def show_caption(caption: Caption, clock: Clock, verbose: bool) -> None:
    kind = "訳" if caption.translated else "原文"
    if caption.message_id:
        # テキスト入力の字幕(確定だけが届く)
        kind = f"テキスト{kind}"
    head = f"{clock.stamp()} {kind}({caption.language or '?'}) {caption.speaker_identity}"
    if caption.is_final:
        # 長い発話は区切りごとに確定する。同じ発話の区切りは utterance_id が同じ
        where = caption.segment_id[:8]
        if caption.message_id:
            where = f"message {caption.message_id[:8]}"
        elif caption.utterance_id:
            where = f"{caption.utterance_id[:8]} #{caption.segment_index}"
        print(f"{head} 確定: {caption.text}  [{where}]")
    elif verbose:
        print(f"{head} 断片: {caption.text}")


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    add_connection_args(p, identity="listener")
    p.add_argument("--verbose", action="store_true", help="字幕の断片も表示する")
    args = p.parse_args()
    # ファイルに書き出しても、届いた順にすぐ見えるようにする
    sys.stdout.reconfigure(line_buffering=True)  # pyright: ignore[reportAttributeAccessIssue]

    clock = Clock()
    room = rtc.Room()
    wanted = translation_track_name(args.language)
    OUT_DIR.mkdir(exist_ok=True)
    tasks: set[asyncio.Task[None]] = set()

    def maybe_subscribe(pub: rtc.RemoteTrackPublication) -> None:
        if pub.name == wanted:
            pub.set_subscribed(True)

    @room.on("track_published")
    def _(pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant) -> None:
        maybe_subscribe(pub)

    @room.on("track_subscribed")
    def _(
        track: rtc.Track, pub: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant
    ) -> None:
        path = OUT_DIR / f"{time.strftime('%Y%m%d-%H%M%S')}-{pub.name}.wav"
        print(f"{clock.stamp()} 購読した: {pub.name}(保存先 {path})")
        task = asyncio.create_task(record(track, path, clock))
        tasks.add(task)

    @room.on("data_received")
    def _(packet: rtc.DataPacket) -> None:
        if packet.topic == CAPTION_TOPIC:
            show_caption(Caption.FromString(packet.data), clock, args.verbose)

    # 翻訳音声のトラックは自分の言語のものだけを選んで購読する
    await room.connect(args.url, make_token(args), rtc.RoomOptions(auto_subscribe=False))
    print(f"{clock.stamp()} 入室した: {args.room} / {args.identity}({args.language})")
    for participant in room.remote_participants.values():
        for pub in participant.track_publications.values():
            maybe_subscribe(pub)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGINT, stop.set)
    loop.add_signal_handler(signal.SIGTERM, stop.set)
    await stop.wait()
    print("退室する")
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
