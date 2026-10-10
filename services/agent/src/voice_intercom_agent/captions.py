"""字幕(Caption)の組み立て。

字幕の区切り(長い発話は途中で区切る。segmenter.py)ごとに segment_id を1つ振り、原文と
各言語の翻訳で共有する。断片(is_final=false)は追記し、確定(is_final=true)はその言語の
全文で置き換える。確定は (segment_id, language, translated) ごとに1回だけ送る。

同じ発話(PTT を押してから離すまで)の区切りは utterance_id を共有し、segment_index で
順番を表す。古いアプリはこの2つを知らないが、区切りを別々の字幕として表示できる。

テキスト入力(text_input.py)の原文と訳もこの形で送る。message_id にアプリが振った ID を入れ、
確定だけを送る。
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
    """1つの区切りの、1つの言語(原文か翻訳)の字幕。"""

    speaker_identity: str
    segment_id: str
    language: str
    translated: bool
    utterance_id: str = ""
    segment_index: int = 0
    message_id: str = ""
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
            utterance_id=self.utterance_id,
            segment_index=self.segment_index,
            message_id=self.message_id,
        )
