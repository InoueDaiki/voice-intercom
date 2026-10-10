"""ストリーミングで届く JSON から、値がそろった項目を順に取り出す。

テキスト入力の翻訳は、翻訳先の全言語を {"en": "...", "ko": "..."} の形(Structured Outputs)で
1回の呼び出しにまとめて受け取る。出力を断片で読み、言語ごとに訳の文字列が閉じた時点で取り出して、
そろった言語から配信と読み上げを始める(PoC の poc/text_bench.py と同じ考え方)。
"""

import json
import re

# JSON の文字列(閉じたものだけ)。エスケープされた " は文字列の途中として扱う
_STRING = re.compile(r'"(?:[^"\\]|\\.)*"')
_SPACE = " \t\r\n"


class FlatJsonStream:
    """文字列の値だけを持つ平らな JSON オブジェクトを、断片で受け取って読む。

    feed() に断片を渡すと、新しく値が閉じた (キー, 値) を返す。keys に無いキーと、
    2回目以降に出てきた同じキーは無視する。形が崩れていたら、それ以降は何も返さない。
    """

    def __init__(self, keys: list[str]) -> None:
        self._keys = set(keys)
        self._seen: set[str] = set()
        self._buf = ""
        self._pos = 0
        self._started = False
        self.broken = False

    @property
    def missing(self) -> list[str]:
        """まだ値がそろっていないキー(順番は固定)。"""
        return sorted(self._keys - self._seen)

    def feed(self, delta: str) -> list[tuple[str, str]]:
        self._buf += delta
        out: list[tuple[str, str]] = []
        while not self.broken and (item := self._next()) is not None:
            key, value = item
            if key in self._keys and key not in self._seen:
                self._seen.add(key)
                out.append((key, value))
        return out

    def _next(self) -> tuple[str, str] | None:
        """次の "キー": "値" を読む。そろっていなければ、位置を進めずに None を返す。"""
        buf = self._buf
        pos = self._pos
        if not self._started:
            pos = _skip(buf, pos, _SPACE)
            if pos >= len(buf):
                return None
            if buf[pos] != "{":
                self.broken = True
                return None
            self._started = True
            self._pos = pos = pos + 1
        pos = _skip(buf, pos, _SPACE + ",")
        if pos >= len(buf) or buf[pos] == "}":
            return None
        key = self._string(pos)
        if key is None:
            return None
        pos = _skip(buf, key[1], _SPACE)
        if pos >= len(buf):
            return None
        if buf[pos] != ":":
            self.broken = True
            return None
        value = self._string(_skip(buf, pos + 1, _SPACE))
        if value is None:
            return None
        self._pos = value[1]
        return key[0], value[0]

    def _string(self, pos: int) -> tuple[str, int] | None:
        """pos から始まる文字列と、その終わりの位置。閉じていなければ None。"""
        if pos >= len(self._buf):
            return None
        if self._buf[pos] != '"':
            # 値が文字列でない(スキーマと違う)
            self.broken = True
            return None
        m = _STRING.match(self._buf, pos)
        if m is None:
            return None
        try:
            return json.loads(m.group()), m.end()
        except json.JSONDecodeError:
            self.broken = True
            return None


def _skip(buf: str, pos: int, chars: str) -> int:
    while pos < len(buf) and buf[pos] in chars:
        pos += 1
    return pos
