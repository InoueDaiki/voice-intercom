"""読み上げ(TTS)の窓口と、読み上げのテキストの比較。

OpenAI の TTS には終了予定のモデルがあり、Google などに替える可能性もあるので(設計メモの
「テキスト入力の翻訳と読み上げ」)、Agent は TextToSpeech だけを使う。最初の実装は
speech_realtime.py(gpt-realtime-2.1-mini)。
"""

import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Protocol

# 読み上げのテキストと渡した文の近さがこれより小さければ、ログに残す。
# PoC では、言葉の付け足し(「ごめん、」)や読み違い(本部 → 首相)があった
MISMATCH_THRESHOLD = 0.9


@dataclass(frozen=True)
class SpeechResult:
    # モデルが返した、実際に読み上げたテキスト。返さない実装は空
    transcript: str = ""


class TextToSpeech(Protocol):
    """読み上げの窓口。"""

    @property
    def sample_rate(self) -> int:
        """on_audio に渡す音声(PCM16・モノラル)のサンプルレート。"""
        ...

    def prepare(self, languages: Iterable[str]) -> None:
        """これらの言語の読み上げを、先に準備しておく(接続を開くなど)。待たずに戻る。"""
        ...

    def keep_only(self, languages: Iterable[str]) -> None:
        """ルームにある言語を知らせる。ほかの言語の準備は片付けてよい(猶予や読み上げ中の扱いは
        実装が決める)。片付けた言語も、speak() が呼ばれれば読み上げる。待たずに戻る。"""
        ...

    async def speak(
        self, text: str, language: str, on_audio: Callable[[bytes], None]
    ) -> SpeechResult:
        """text を読み上げ、音声を届いた順に on_audio に渡す。失敗したら例外を投げる。"""
        ...

    async def aclose(self) -> None: ...


def normalize(s: str) -> str:
    """比較用。句読点・記号・空白を除き、全角半角と大文字小文字をそろえる(PoC と同じ)。"""
    s = unicodedata.normalize("NFKC", s).lower()
    return "".join(c for c in s if unicodedata.category(c)[0] not in "PZS")


def similarity(a: str, b: str) -> float:
    """一致した文字数を、長いほうの文字数で割る(0〜1)。

    SequenceMatcher.ratio() は2つの長さの平均で割るので、短い付け足し(「ごめん、」)を見逃しやすい。
    """
    a, b = normalize(a), normalize(b)
    if not a and not b:
        return 1.0
    matched = sum(m.size for m in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks())
    return matched / max(len(a), len(b))


def speech_mismatch(text: str, transcript: str) -> float | None:
    """読み上げのテキストが渡した文と大きく違えば、その近さ(0〜1)を返す。

    読み上げのテキストが無い(返さない実装、または失敗)ときは比べない。
    """
    if not transcript.strip():
        return None
    score = similarity(text, transcript)
    return score if score < MISMATCH_THRESHOLD else None
