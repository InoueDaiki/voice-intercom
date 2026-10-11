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


def noise(dbfs: float, seconds: float, seed: int = 0) -> list[bytes]:
    """dbfs の音量のホワイトノイズを 10ms のフレームに分けて返す(部屋の雑音の代わり)。"""
    rng = np.random.default_rng(seed)
    n = int(SAMPLE_RATE * FRAME_S)
    rms = 32768 * 10 ** (dbfs / 20)
    return [
        np.clip(rng.normal(0, rms, n), -32768, 32767).astype(np.int16).tobytes()
        for _ in range(round(seconds / FRAME_S))
    ]


def speech(voice_dbfs: float, noise_dbfs: float, seconds: float, seed: int = 0) -> list[bytes]:
    """声の代わり。150ms の音と 50ms の音節の間(雑音だけ)を繰り返し、雑音を重ねる。"""
    room = noise(noise_dbfs, seconds, seed)
    amplitude = 32768 * 10 ** (voice_dbfs / 20) * np.sqrt(2)
    tone = np.frombuffer(frame(round(amplitude)), np.int16).astype(np.int32)
    out = []
    for i, f in enumerate(room):
        pcm = np.frombuffer(f, np.int16).astype(np.int32)
        if i % 20 < 15:
            pcm = pcm + tone
        out.append(np.clip(pcm, -32768, 32767).astype(np.int16).tobytes())
    return out


def feed_frames(segmenter: Segmenter, frames: list[bytes]) -> list[int]:
    return [i for i, f in enumerate(frames) if segmenter.audio(f)]


RELATIVE = SegmentRules(silence_ratio=0.25)
FIXED = SegmentRules(silence_ratio=None)


def test_relative_threshold_finds_pauses_in_quiet_voice() -> None:
    # 声が -60 dBFS、雑音が -85 dBFS。固定の -50 dBFS では全体が無音になり、区切れない
    for rules, expected in ((FIXED, 0), (RELATIVE, 1)):
        seg = Segmenter(rules)
        feed_frames(seg, speech(-60, -85, 5.0))
        seg.text("Gate 14 on Thursday.")
        assert len(feed_frames(seg, noise(-85, 0.5, seed=1))) == expected


def test_relative_threshold_finds_pauses_in_noisy_room() -> None:
    # 雑音が -35 dBFS(固定の -50 dBFS より大きい)、声が -20 dBFS
    for rules, expected in ((FIXED, 0), (RELATIVE, 1)):
        seg = Segmenter(rules)
        feed_frames(seg, speech(-20, -35, 5.0))
        seg.text("打ち合わせをします。")
        assert len(feed_frames(seg, noise(-35, 0.5, seed=1))) == expected


def test_relative_threshold_keeps_short_breaths_unsplit() -> None:
    # 文の途中の息継ぎ(0.6秒)では、相対の閾値でも区切らない
    seg = Segmenter(RELATIVE)
    seg.text("明日の午後3時に")
    for i in range(4):
        assert feed_frames(seg, speech(-30, -60, 2.0, seed=i)) == []
        assert feed_frames(seg, noise(-60, 0.6, seed=10 + i)) == []


def test_relative_threshold_does_not_split_noise_only() -> None:
    # 声が無く雑音だけなら、どこも無音とみなさない(声が1秒に満たない区切りは区切らない)
    seg = Segmenter(RELATIVE)
    seg.text("。")
    assert feed_frames(seg, noise(-40, 8.0)) == []


def test_relative_threshold_after_speech_ends() -> None:
    # 話し終えた後、PTT を押したまま雑音が続いても、次の区切りは声が無いので区切らない
    seg = Segmenter(RELATIVE)
    feed_frames(seg, speech(-30, -60, 5.0))
    seg.text("します。")
    assert len(feed_frames(seg, noise(-60, 0.5))) == 1
    assert feed_frames(seg, noise(-60, 8.0, seed=1)) == []


def test_relative_threshold_uses_fixed_threshold_while_warming_up() -> None:
    seg = Segmenter(RELATIVE)
    assert seg.silence_threshold() == RELATIVE.silence_dbfs
    feed_frames(seg, speech(-24, -80, 2.0))
    # 床(-80 付近)から声(-24 付近)までの 25% の位置
    assert -70 < seg.silence_threshold() < -62
