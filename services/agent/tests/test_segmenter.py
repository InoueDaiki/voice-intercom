import numpy as np

from voice_intercom_agent.segmenter import (
    SAMPLE_RATE,
    Segmenter,
    SegmentRules,
    ends_sentence,
    frame_dbfs,
    should_split,
)

RULES = SegmentRules(min_s=4.0, pause_s=0.4, long_pause_s=1.0, max_s=15.0, silence_dbfs=-50.0)
FRAME_S = 0.01


def frame(amplitude: int) -> bytes:
    """10ms のフレーム。amplitude が 0 なら無音。"""
    n = int(SAMPLE_RATE * FRAME_S)
    t = np.arange(n) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.int16).tobytes()


VOICE = frame(3000)
SILENCE = frame(0)


def feed(segmenter: Segmenter, pcm: bytes, seconds: float) -> list[int]:
    """seconds 秒ぶんのフレームを渡し、区切ったフレームの番号を返す。"""
    return [i for i in range(round(seconds / FRAME_S)) if segmenter.audio(pcm)]


def test_sentence_ends() -> None:
    assert ends_sentence("打ち合わせをします。")
    assert ends_sentence("もう一度お願いします?")
    assert ends_sentence("Gate 14 on Thursday. ")
    assert ends_sentence("「了解です。」")
    assert not ends_sentence("明日の午後3時に、")
    assert not ends_sentence("")


def test_frame_level() -> None:
    assert frame_dbfs(SILENCE) == float("-inf")
    # 振幅 3000 の正弦波は約 -24 dBFS
    assert -25 < frame_dbfs(VOICE) < -23
    assert frame_dbfs(b"") == float("-inf")


def test_no_split_before_min_length() -> None:
    # 文末で長い無音があっても、最短の長さに届かなければ区切らない
    assert not should_split(elapsed_s=3.9, speech_s=3.0, pause_s=2.0, text="はい。", rules=RULES)


def test_short_pause_after_sentence_end_splits() -> None:
    assert should_split(elapsed_s=5.0, speech_s=4.0, pause_s=0.4, text="します。", rules=RULES)
    assert not should_split(elapsed_s=5.0, speech_s=4.0, pause_s=0.3, text="します。", rules=RULES)


def test_short_pause_without_sentence_end_does_not_split() -> None:
    # 書き起こしが文の途中なら、息継ぎでは区切らない
    assert not should_split(elapsed_s=5.0, speech_s=4.0, pause_s=0.5, text="3時に、", rules=RULES)


def test_long_pause_splits_without_sentence_end() -> None:
    # 書き起こしの文末が遅れて届いていない場合も、長い無音なら区切る
    assert should_split(elapsed_s=5.0, speech_s=4.0, pause_s=1.0, text="3時に", rules=RULES)


def test_long_segment_splits_on_short_pause() -> None:
    assert should_split(elapsed_s=15.0, speech_s=12.0, pause_s=0.4, text="それで", rules=RULES)


def test_no_split_without_enough_speech() -> None:
    # 声が小さく閾値を下回るなど、ほとんど無音の区切りでは区切らない
    assert not should_split(elapsed_s=8.0, speech_s=0.5, pause_s=3.0, text="", rules=RULES)


def test_segmenter_splits_at_pause_after_sentence() -> None:
    seg = Segmenter(RULES)
    assert feed(seg, VOICE, 5.0) == []
    seg.text("明日の午後3時に打ち合わせをします。")
    # 0.4秒の無音の最後のフレームで区切る
    assert feed(seg, SILENCE, 0.5) == [39]


def test_segmenter_ignores_short_pauses_mid_sentence() -> None:
    seg = Segmenter(RULES)
    seg.text("明日の午後3時に")
    for _ in range(4):
        assert feed(seg, VOICE, 2.0) == []
        assert feed(seg, SILENCE, 0.6) == []


def test_segmenter_resets_after_split() -> None:
    seg = Segmenter(RULES)
    feed(seg, VOICE, 5.0)
    seg.text("します。")
    assert len(feed(seg, SILENCE, 0.4)) == 1
    # 次の区切りは書き起こしも長さも0から数える
    assert feed(seg, SILENCE, 2.0) == []
    assert feed(seg, VOICE, 3.0) == []
    assert feed(seg, SILENCE, 0.5) == []
    assert len(feed(seg, SILENCE, 0.6)) == 1


def test_segmenter_does_not_split_short_utterance() -> None:
    # PTT の短い発話(2〜4秒)は区切らず、離したときの commit だけで確定する
    seg = Segmenter(RULES)
    seg.text("はい、了解です。")
    assert feed(seg, VOICE, 2.0) == []
    assert feed(seg, SILENCE, 1.5) == []
