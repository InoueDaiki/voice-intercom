"""長い発話の字幕の区切り。発話の途中で whisper の書き起こしを確定させる位置を決める。

構成 B では、訳の字幕は whisper の書き起こしが確定してから作る。PTT を離すまで確定しないと、
長い発話では訳の字幕がずっと出ないので、発話の途中に区切りを作る。

gpt-realtime-whisper はサーバー側の自動区切り(turn_detection)に対応していない(null にする
決まり)ので、Agent 側で区切りを決め、input_audio_buffer.commit を送る。区切り方は、
音量で見つけた息継ぎ(無音)と、書き起こしの文末(「。」「?」など)を組み合わせる。

- 区切りの最短の長さ(min_s)に届くまでは区切らない。細かすぎると訳の質が下がる
- 文末で終わっていて、短い無音(pause_s)が続いたら区切る
- 文末でなくても、長い無音(long_pause_s)が続いたら区切る
- 区切りが長く(max_s)なったら、文末でなくても短い無音で区切る

書き起こしは音声より1秒ほど遅れて届くので、息継ぎの時点で文末がまだ届いていないことがある。
そのときは長い無音で区切られる。音声の途中で切ることはない(必ず無音のところで区切る)。
"""

import math
from dataclasses import dataclass

import numpy as np

# 入力は 24kHz・PCM16・モノラル(realtime.INPUT_SAMPLE_RATE と同じ)
SAMPLE_RATE = 24000

# 区切りの中に声がこれだけ無ければ区切らない(ずっと無音か、声が小さすぎて閾値を下回る場合)
MIN_SPEECH_S = 1.0

# 文末とみなす文字。日本語・中国語の句点、各言語の終止符と疑問符・感嘆符、ヒンディー語のダンダ
SENTENCE_ENDS = frozenset("。．.?？!！।")
# 文末の後ろに付いていてもよい閉じ括弧や引用符
CLOSERS = frozenset("」』)）\"'”’]")


@dataclass(frozen=True)
class SegmentRules:
    """区切りの条件(秒と dBFS)。"""

    # 区切りの最短の長さ(区切りの先頭からの音声の長さ)
    min_s: float = 4.0
    # 文末の後に、これだけ無音が続いたら区切る
    pause_s: float = 0.4
    # 文末でなくても、これだけ無音が続いたら区切る
    long_pause_s: float = 1.0
    # 区切りがこれより長くなったら、文末でなくても pause_s の無音で区切る
    max_s: float = 15.0
    # これより小さい音量(10ms ほどのフレームの RMS)を無音とみなす
    silence_dbfs: float = -50.0


def ends_sentence(text: str) -> bool:
    """書き起こしが文末で終わっているか。"""
    stripped = text.rstrip()
    while stripped and stripped[-1] in CLOSERS:
        stripped = stripped[:-1].rstrip()
    return bool(stripped) and stripped[-1] in SENTENCE_ENDS


def frame_dbfs(pcm: bytes) -> float:
    """PCM16 のフレームの RMS を dBFS で返す。無音(すべて0)なら -inf。"""
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float64)
    if samples.size == 0:
        return -math.inf
    rms = float(np.sqrt(np.mean(samples**2)))
    return 20 * math.log10(rms / 32768) if rms > 0 else -math.inf


def should_split(
    *, elapsed_s: float, speech_s: float, pause_s: float, text: str, rules: SegmentRules
) -> bool:
    """区切るかどうか。elapsed_s は区切りの長さ、pause_s は末尾に続いている無音の長さ。"""
    if elapsed_s < rules.min_s or speech_s < MIN_SPEECH_S:
        return False
    if pause_s >= rules.long_pause_s:
        return True
    return pause_s >= rules.pause_s and (ends_sentence(text) or elapsed_s >= rules.max_s)


class Segmenter:
    """1つの発話の中の区切りを決める。音声と、今の区切りの書き起こしの断片を順に渡す。"""

    def __init__(self, rules: SegmentRules) -> None:
        self._rules = rules
        self._reset()

    def _reset(self) -> None:
        # 長さはサンプル数で数える(秒の足し算の丸め誤差を避ける)
        self._elapsed = 0
        self._speech = 0
        self._pause = 0
        self._text = ""

    def text(self, delta: str) -> None:
        """今の区切りの書き起こしの断片。"""
        self._text += delta

    def audio(self, pcm: bytes) -> bool:
        """音声のフレームを1つ渡す。このフレームの後ろで区切るなら True を返し、次の区切りへ移る。

        フレームは 10ms ほどの長さを想定する(LiveKit の AudioStream が渡す単位)。
        """
        samples = len(pcm) // 2
        self._elapsed += samples
        if frame_dbfs(pcm) < self._rules.silence_dbfs:
            self._pause += samples
        else:
            self._speech += samples
            self._pause = 0
        split = should_split(
            elapsed_s=self._elapsed / SAMPLE_RATE,
            speech_s=self._speech / SAMPLE_RATE,
            pause_s=self._pause / SAMPLE_RATE,
            text=self._text,
            rules=self._rules,
        )
        if split:
            self._reset()
        return split
