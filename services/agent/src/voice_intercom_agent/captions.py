"""字幕(Caption)の組み立て。

1つの発話に segment_id を1つ振り、原文と各言語の翻訳で共有する。断片(is_final=false)は
追記し、確定(is_final=true)はその言語の全文で置き換える。
"""

import uuid
from dataclasses import dataclass, field

from voiceintercom.v1.caption_pb2 import Caption

# データチャネルの topic
CAPTION_TOPIC = "caption"


def new_segment_id() -> str:
    return uuid.uuid4().hex


@dataclass
class CaptionTrack:
    """1つの発話の、1つの言語(原文か翻訳)の字幕。"""

    speaker_identity: str
    segment_id: str
    language: str
    translated: bool
    _sent: list[str] = field(default_factory=list)
    _finalized: bool = False

    @property
    def sent_any(self) -> bool:
        return bool(self._sent)

    def delta(self, text: str) -> Caption | None:
        if not text or self._finalized:
            return None
        self._sent.append(text)
        return self._caption(text, is_final=False)

    def final(self, text: str) -> Caption | None:
        """確定させる。断片を送っていなくて全文も空なら、何も送らない。"""
        if self._finalized or (not text and not self._sent):
            return None
        self._finalized = True
        return self._caption(text, is_final=True)

    def _caption(self, text: str, *, is_final: bool) -> Caption:
        return Caption(
            speaker_identity=self.speaker_identity,
            segment_id=self.segment_id,
            language=self.language,
            translated=self.translated,
            text=text,
            is_final=is_final,
        )
