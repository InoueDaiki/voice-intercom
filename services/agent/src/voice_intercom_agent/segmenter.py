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

無音の決め方は2つある。固定の閾値(silence_dbfs)と、発話の中の音量からの相対値
(silence_ratio)。相対値では、発話の始めからのフレームの音量の上位 10% を声の大きさ、下位 5% を
雑音の床とみなし、床から声までの silence_ratio の位置より小さい音量を無音とみなす。端末や話し方で
声の大きさが変わっても(小さい声、雑音の多い場所)、息継ぎを見つけられるようにする。
声の大きさだけからの相対値(声より何 dB 小さいか)は、雑音の多い録音(声と床の差が 15dB ほど)で
息継ぎを見つけられなかった(設計メモの「Agent の見直し」)。
"""

import math
from dataclasses import dataclass

import numpy as np

# 入力は 24kHz・PCM16・モノラル(realtime.INPUT_SAMPLE_RATE と同じ)
SAMPLE_RATE = 24000

# 区切りの中に声がこれだけ無ければ区切らない(ずっと無音か、声が小さすぎて閾値を下回る場合)
MIN_SPEECH_S = 1.0

# 相対の閾値で、声の大きさと雑音の床とみなすフレームの音量の百分位(上位 10% と下位 5%)
VOICE_PERCENTILE = 90.0
FLOOR_PERCENTILE = 5.0
# 声と床の差がこれより小さければ、声が無い(雑音だけ)とみなし、何も無音とみなさない
MIN_VOICE_ABOVE_FLOOR_DB = 6.0
# 相対の閾値を使い始めるのに要る、発話の始めからの長さ。それまでは固定の閾値を使う
LEVEL_WARMUP_S = 1.0
# これより小さい音量は、どちらの方式でも無音とみなし、音量の計算にも入れない(デジタルの無音など)
FLOOR_DBFS = -100.0

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
    # これより小さい音量(10ms ほどのフレームの RMS)を無音とみなす。相対の閾値では使い始める前だけ
    silence_dbfs: float = -50.0
    # None でなければ相対の閾値にする。雑音の床から声の大きさまでの、この割合の位置を閾値にする
    silence_ratio: float | None = 0.25


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


class LevelTracker:
    """発話の始めからのフレームの音量を 1dB 刻みのヒストグラムにため、百分位を返す。"""

    def __init__(self) -> None:
        self._bins = np.zeros(int(-FLOOR_DBFS) + 1, dtype=np.int64)
        self._count = 0
        self._samples = 0

    def add(self, dbfs: float, samples: int) -> None:
        self._samples += samples
        if dbfs < FLOOR_DBFS:
            return
        self._bins[min(int(dbfs - FLOOR_DBFS), len(self._bins) - 1)] += 1
        self._count += 1

    @property
    def seconds(self) -> float:
        return self._samples / SAMPLE_RATE

    def percentile(self, q: float) -> float | None:
        """フレームの音量の百分位(dBFS、1dB 刻み)。音のあるフレームが無ければ None。"""
        if self._count == 0:
            return None
        rank = max(1, math.ceil(self._count * q / 100))
        index = int(np.searchsorted(np.cumsum(self._bins), rank))
        return FLOOR_DBFS + index


class Segmenter:
    """1つの発話の中の区切りを決める。音声と、今の区切りの書き起こしの断片を順に渡す。"""

    def __init__(self, rules: SegmentRules) -> None:
        self._rules = rules
        # 声の大きさは区切りをまたいで発話の始めから測る(区切りの直後の短い区間でも安定させる)
        self._level = LevelTracker()
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
        dbfs = frame_dbfs(pcm)
        self._level.add(dbfs, samples)
        if dbfs < self.silence_threshold():
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

    def silence_threshold(self) -> float:
        """今の無音の閾値(dBFS)。"""
        ratio = self._rules.silence_ratio
        if ratio is None or self._level.seconds < LEVEL_WARMUP_S:
            return self._rules.silence_dbfs
        voice = self._level.percentile(VOICE_PERCENTILE)
        floor = self._level.percentile(FLOOR_PERCENTILE)
        if voice is None or floor is None:
            return self._rules.silence_dbfs
        if voice - floor < MIN_VOICE_ABOVE_FLOOR_DB:
            return FLOOR_DBFS
        return floor + ratio * (voice - floor)
