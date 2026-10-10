"""言語別のトラックに、同時に話している話者の翻訳音声を混ぜて流す。

翻訳音声は 200ms ごとにまとまって届く。時計で引き出すと届く前に無音を挟んでしまうので、
届いた分だけを混ぜる。各入力は、1チャンク分がたまるか、閉じられて残りがあるときに出せる。
まだたまっていない入力は、そのチャンクでは無音として扱い、データは次に回す。

テキスト入力の読み上げは、言語ごとに同じ key で続けて入れる。閉じた後に同じ key で入れると、
閉じたことを取り消して続きとして扱うので、続けて読み上げた文が重ならずに順に流れる。
"""

import numpy as np


class Mixer:
    def __init__(self, chunk_samples: int) -> None:
        self._chunk = chunk_samples
        self._buffers: dict[object, np.ndarray] = {}
        self._closed: set[object] = set()

    def push(self, key: object, pcm: bytes) -> None:
        data = np.frombuffer(pcm, dtype=np.int16)
        # 閉じた入力に続きが来たら、閉じたことを取り消す(残りの後ろに続ける)
        self._closed.discard(key)
        buf = self._buffers.get(key)
        self._buffers[key] = data if buf is None else np.concatenate([buf, data])

    def close(self, key: object) -> None:
        """入力の終わり。残りは無音で埋めて出し、出しきったら消す。"""
        buf = self._buffers.get(key)
        if buf is None:
            return
        if len(buf) == 0:
            del self._buffers[key]
        else:
            self._closed.add(key)

    def pop(self) -> bytes | None:
        """出せる入力を1チャンクずつ混ぜて返す。出せる入力がなければ None。"""
        parts: list[np.ndarray] = []
        for key in list(self._buffers):
            if not self._can_take(key):
                continue
            buf = self._buffers[key]
            part, rest = buf[: self._chunk], buf[self._chunk :]
            if len(part) < self._chunk:
                part = np.pad(part, (0, self._chunk - len(part)))
            parts.append(part.astype(np.int32))
            if len(rest) == 0 and key in self._closed:
                del self._buffers[key]
                self._closed.discard(key)
            else:
                self._buffers[key] = rest
        if not parts:
            return None
        mixed = np.clip(np.sum(parts, axis=0), -32768, 32767).astype(np.int16)
        return mixed.tobytes()

    def _can_take(self, key: object) -> bool:
        n = len(self._buffers[key])
        return n >= self._chunk or (key in self._closed and n > 0)
