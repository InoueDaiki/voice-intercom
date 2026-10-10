"""環境変数から読む設定。モデル名は、OpenAI の非推奨化に備えて差し替えられるようにする。"""

import os
from dataclasses import dataclass

from .segmenter import SegmentRules

DEFAULT_AGENT_NAME = "voice-intercom"


@dataclass(frozen=True)
class Settings:
    openai_api_key: str
    translate_model: str
    whisper_model: str
    text_translate_model: str
    # session.close から session.closed を待つ上限(PoC では 4〜6秒、長いと35秒)
    translate_close_timeout_s: float
    # input_audio_buffer.commit から completed を待つ上限(PoC では約0.6秒)
    whisper_commit_timeout_s: float
    # 長い発話の字幕の区切り。None なら区切らない(PTT を離すまで確定しない)
    segment_rules: SegmentRules | None
    # テキスト入力の読み上げ(speech_realtime.py)
    tts_model: str
    tts_voice: str
    # 1回の読み上げの上限(PoC では、5秒の音声を約1.2秒で受け取り終える)
    tts_timeout_s: float
    # ルームにある言語の読み上げのセッションを、先に開いておくか(接続と設定に約0.9秒かかる)
    tts_prewarm: bool
    # テキスト入力の最大の文字数。超えたものは断る
    text_max_chars: int

    @classmethod
    def from_env(cls) -> Settings:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY が空です。.env に設定してください")
        return cls(
            openai_api_key=api_key,
            translate_model=os.environ.get("TRANSLATE_MODEL", "gpt-realtime-translate"),
            whisper_model=os.environ.get("WHISPER_MODEL", "gpt-realtime-whisper"),
            text_translate_model=os.environ.get("TEXT_TRANSLATE_MODEL", "gpt-6-luna"),
            translate_close_timeout_s=float(os.environ.get("TRANSLATE_CLOSE_TIMEOUT_S", "40")),
            whisper_commit_timeout_s=float(os.environ.get("WHISPER_COMMIT_TIMEOUT_S", "10")),
            segment_rules=segment_rules_from_env(),
            tts_model=os.environ.get("TTS_MODEL", "gpt-realtime-2.1-mini"),
            tts_voice=os.environ.get("TTS_VOICE", "marin"),
            tts_timeout_s=float(os.environ.get("TTS_TIMEOUT_S", "30")),
            tts_prewarm=os.environ.get("TTS_PREWARM", "1") != "0",
            text_max_chars=int(os.environ.get("TEXT_MAX_CHARS", "500")),
        )


def segment_rules_from_env() -> SegmentRules | None:
    """字幕の区切りの設定。SEGMENT_ENABLED を 0 にすると区切らない。"""
    if os.environ.get("SEGMENT_ENABLED", "1") == "0":
        return None
    d = SegmentRules()
    return SegmentRules(
        min_s=float(os.environ.get("SEGMENT_MIN_S", d.min_s)),
        pause_s=float(os.environ.get("SEGMENT_PAUSE_S", d.pause_s)),
        long_pause_s=float(os.environ.get("SEGMENT_LONG_PAUSE_S", d.long_pause_s)),
        max_s=float(os.environ.get("SEGMENT_MAX_S", d.max_s)),
        silence_dbfs=float(os.environ.get("SEGMENT_SILENCE_DBFS", d.silence_dbfs)),
    )


def agent_name() -> str:
    """明示ディスパッチの agent_name。ルームのトークンや lk dispatch で同じ名前を指定する。"""
    return os.environ.get("AGENT_NAME", DEFAULT_AGENT_NAME)
