"""translate の session.close の後にまとめて届く、末尾の無音を捨てる。

translate は、session.close を送った後に残りの翻訳音声と、その後ろに長い無音(1発話で約9〜30秒分。
PoC の記録で、最大の振幅が 0〜1 のチャンクが続く)をまとめて返す。混ぜても聞こえ方は変わらないが、
言語別のトラックで実時間で流れ、その間トラックの送出を占める(設計メモの「翻訳音声の末尾の無音」)。

翻訳音声の途中の間や、末尾の本物の小さな声を削らないよう、捨てるものを次に限る。

- 対象は session.close の後に届いた音声だけ。close の前の音声は、無音もそのまま流す。
- 捨てるのは、最後に声のあったフレームより後ろの、続いた無音だけ。無音の後に声が来たら、
  ためていた無音も声の前にそのまま流す(途中の間は保つ)。
- 無音とみなすのは、フレーム(10ms)の最大の振幅が SILENCE_PEAK 以下のものだけ。PoC の記録では、
  声の終わりの減衰も 9、5、3 と続くので、ほぼデジタルの無音だけを捨てる。
- 最後の声の後の無音も、KEEP_S だけは残す(声の終わりを切らない)。
"""

from collections.abc import Callable

import numpy as np

# PCM16 の最大の振幅がこれ以下のフレームを無音とみなす(-72 dBFS ほど)
SILENCE_PEAK = 8
# 無音を判定するフレームの長さ(秒)
FRAME_S = 0.01
# 最後の声の後に残す無音(秒)
KEEP_S = 0.2


class TrailingSilenceTrimmer:
    """音声を on_audio に渡す。closed() の後に届いた音声の、末尾の無音だけを捨てる。"""

    def __init__(self, on_audio: Callable[[bytes], None], sample_rate: int) -> None:
        self._on_audio = on_audio
        self._sample_rate = sample_rate
        self._frame = max(1, round(sample_rate * FRAME_S))
        self._keep = round(sample_rate * KEEP_S) * 2
        self._closed = False
        # 最後に声のあったフレームより後ろの、まだ流していない無音(close の後だけ)
        self._pending = bytearray()

    def closed(self) -> None:
        """session.close を送ったら呼ぶ。ここから後に届いた音声を見る。"""
        self._closed = True

    def push(self, pcm: bytes) -> None:
        if not self._closed:
            self._on_audio(pcm)
            return
        end = self._voiced_end(pcm)
        if end == 0:
            self._pending += pcm
            return
        # 声が来たら、ためていた無音(途中の間)も一緒に流す
        self._on_audio(bytes(self._pending) + pcm[:end])
        self._pending = bytearray(pcm[end:])

    def finish(self) -> float:
        """セッションの終わりに呼ぶ。末尾の無音を KEEP_S だけ残して流し、捨てた秒数を返す。"""
        keep, dropped = self._pending[: self._keep], len(self._pending) - self._keep
        self._pending = bytearray()
        if keep:
            self._on_audio(bytes(keep))
        return max(0, dropped) / 2 / self._sample_rate

    def _voiced_end(self, pcm: bytes) -> int:
        """最後に声のあったフレームの終わり(バイト)。声が無ければ 0。"""
        samples = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.int32)
        if len(samples) == 0:
            return 0
        frames = -(-len(samples) // self._frame)
        padded = np.pad(np.abs(samples), (0, frames * self._frame - len(samples)))
        voiced = np.flatnonzero(padded.reshape(frames, self._frame).max(axis=1) > SILENCE_PEAK)
        if len(voiced) == 0:
            return 0
        return min(len(samples), (int(voiced[-1]) + 1) * self._frame) * 2
