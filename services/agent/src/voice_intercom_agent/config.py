"""環境変数から読む設定。モデル名は、OpenAI の非推奨化に備えて差し替えられるようにする。"""

import os
from dataclasses import dataclass

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
        )


def agent_name() -> str:
    """明示ディスパッチの agent_name。ルームのトークンや lk dispatch で同じ名前を指定する。"""
    return os.environ.get("AGENT_NAME", DEFAULT_AGENT_NAME)
