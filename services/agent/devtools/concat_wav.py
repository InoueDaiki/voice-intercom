"""WAV を無音を挟んでつなぎ、長い発話の音声を作る(字幕の区切りを確かめる用)。

`poc/make_audio.sh` は macOS の say を使うので、devContainer では長い音声を作れない。
既にある短い WAV(`poc/audio/ja-01.wav` や FLEURS の WAV)をつないで代わりにする。
引数は WAV と、無音の秒数(数字)を並べる。出力は 24kHz・PCM16・モノラル。

    uv run services/agent/devtools/concat_wav.py -o services/agent/poc/audio/long-ja-cat.wav \
      services/agent/poc/audio/ja-01.wav 1.2 services/agent/poc/audio/ja-03.wav 0.5 ...

つないだ後、無音の区間(-50 dBFS 未満が 0.3秒以上)を表示する。区切りの位置の見当に使う。
"""

import argparse
import wave
from pathlib import Path

import numpy as np
from common import load_pcm

from voice_intercom_agent.segmenter import frame_dbfs

SAMPLE_RATE = 24000
FRAME = SAMPLE_RATE // 100  # 10ms


def silences(pcm: np.ndarray, threshold_dbfs: float, min_s: float) -> list[tuple[float, float]]:
    """閾値未満の音量が min_s 以上続く区間(秒の始まりと終わり)。"""
    spans: list[tuple[float, float]] = []
    start: int | None = None
    for i in range(0, len(pcm), FRAME):
        quiet = frame_dbfs(pcm[i : i + FRAME].tobytes()) < threshold_dbfs
        if quiet and start is None:
            start = i
        elif not quiet and start is not None:
            if (i - start) / SAMPLE_RATE >= min_s:
                spans.append((start / SAMPLE_RATE, i / SAMPLE_RATE))
            start = None
    if start is not None and (len(pcm) - start) / SAMPLE_RATE >= min_s:
        spans.append((start / SAMPLE_RATE, len(pcm) / SAMPLE_RATE))
    return spans


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("-o", "--output", type=Path, required=True)
    p.add_argument("parts", nargs="+", help="WAV のパスか、無音の秒数")
    p.add_argument("--silence-dbfs", type=float, default=-50.0, help="無音とみなす音量")
    args = p.parse_args()

    chunks: list[np.ndarray] = []
    for part in args.parts:
        try:
            seconds = float(part)
        except ValueError:
            chunks.append(load_pcm(Path(part), SAMPLE_RATE))
        else:
            chunks.append(np.zeros(int(seconds * SAMPLE_RATE), dtype=np.int16))
    pcm = np.concatenate(chunks)
    with wave.open(str(args.output), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    print(f"{args.output}: {len(pcm) / SAMPLE_RATE:.1f}秒")
    for start, end in silences(pcm, args.silence_dbfs, 0.3):
        print(f"  無音 {start:6.2f}〜{end:6.2f}秒({end - start:.2f}秒)")


if __name__ == "__main__":
    main()
