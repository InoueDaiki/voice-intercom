"""翻訳先の言語の決め方。

参加者の言語は、LiveKit の参加者の属性 `language` に入れる(トークンの発行時に設定する)。
値は BCP 47 の言語コードで、主言語の部分(`ja-JP` なら `ja`)だけを見る。

音声をつないでいるか(マイクとスピーカーを使うか)は、属性 `audio`(`on` か `off`)に入れる
(services/api の participants.py)。ルームの画面を開いているだけの人は `off` で、翻訳の音声と
読み上げは作らず、訳の字幕だけを作る。
"""

from collections.abc import Iterable, Mapping

# 参加者の属性のキー
LANGUAGE_ATTRIBUTE = "language"
AUDIO_ATTRIBUTE = "audio"
AUDIO_OFF = "off"

# gpt-realtime-translate が出力できる13言語と、翻訳の指示に使う名前
LANGUAGE_NAMES: dict[str, str] = {
    "es": "Spanish",
    "pt": "Portuguese",
    "fr": "French",
    "ja": "Japanese",
    "ru": "Russian",
    "zh": "Chinese",
    "de": "German",
    "ko": "Korean",
    "hi": "Hindi",
    "id": "Indonesian",
    "vi": "Vietnamese",
    "it": "Italian",
    "en": "English",
}


def normalize(code: str | None) -> str | None:
    """言語コードを主言語の小文字にする。対応していない言語なら None。"""
    if not code:
        return None
    primary = code.strip().replace("_", "-").split("-")[0].lower()
    return primary if primary in LANGUAGE_NAMES else None


def participant_language(attributes: Mapping[str, str]) -> str | None:
    return normalize(attributes.get(LANGUAGE_ATTRIBUTE))


def wants_audio(attributes: Mapping[str, str]) -> bool:
    """音声を聞いているか。属性が無い参加者(前のアプリ)は聞いているとみなす。"""
    return attributes.get(AUDIO_ATTRIBUTE) != AUDIO_OFF


def target_languages(speaker: str | None, listeners: Iterable[str | None]) -> list[str]:
    """翻訳先の言語。聞き手の言語から、話者と同じ言語と不明な言語を除く。

    話者の言語が不明なら、聞き手の言語をすべて対象にする。順番は固定(テストとログのため)。
    """
    return sorted({lang for lang in listeners if lang is not None and lang != speaker})
