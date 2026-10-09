"""話者としてルームに入り、WAV を PTT のように流す。

アプリと同じく、入室時にトラックを publish してミュートしておき、WAV を流す間だけ
ミュートを外す。lk CLI では試せない「ミュートで発話が終わる」経路を確かめるのに使う。

使い方は services/agent/README.md を参照する。
"""

import argparse
import asyncio
from pathlib import Path

from common import add_connection_args, load_pcm, make_token
from livekit import rtc

SAMPLE_RATE = 48000
FRAME_SAMPLES = SAMPLE_RATE // 100  # 10ms


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    add_connection_args(p, identity="speaker")
    p.add_argument("wavs", type=Path, nargs="+", help="流す WAV(16bit)。1ファイルが1回の発話")
    p.add_argument("--gap", type=float, default=8.0, help="発話の間にミュートしておく秒数")
    p.add_argument("--wait", type=float, default=3.0, help="入室してから最初の発話までの秒数")
    args = p.parse_args()

    room = rtc.Room()
    await room.connect(args.url, make_token(args))
    print(f"入室した: {args.room} / {args.identity}({args.language})")

    source = rtc.AudioSource(SAMPLE_RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("microphone", source)
    options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    await room.local_participant.publish_track(track, options)
    track.mute()
    # Agent がトラックを購読するのを待つ
    await asyncio.sleep(args.wait)

    for i, path in enumerate(args.wavs):
        pcm = load_pcm(path, SAMPLE_RATE)
        print(f"話す: {path.name}({len(pcm) / SAMPLE_RATE:.1f}秒)")
        track.unmute()
        for start in range(0, len(pcm), FRAME_SAMPLES):
            chunk = pcm[start : start + FRAME_SAMPLES]
            frame = rtc.AudioFrame(chunk.tobytes(), SAMPLE_RATE, 1, len(chunk))
            await source.capture_frame(frame)
        await source.wait_for_playout()
        track.mute()
        print("離した")
        if i < len(args.wavs) - 1:
            await asyncio.sleep(args.gap)

    # 最後の発話の翻訳が届くまで、ルームに残る(退室すると、ルームが閉じることがある)
    await asyncio.sleep(args.gap)
    await source.aclose()
    await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
