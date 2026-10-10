from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class Caption(_message.Message):
    __slots__ = ("speaker_identity", "segment_id", "language", "translated", "text", "is_final", "utterance_id", "segment_index")
    SPEAKER_IDENTITY_FIELD_NUMBER: _ClassVar[int]
    SEGMENT_ID_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TRANSLATED_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    IS_FINAL_FIELD_NUMBER: _ClassVar[int]
    UTTERANCE_ID_FIELD_NUMBER: _ClassVar[int]
    SEGMENT_INDEX_FIELD_NUMBER: _ClassVar[int]
    speaker_identity: str
    segment_id: str
    language: str
    translated: bool
    text: str
    is_final: bool
    utterance_id: str
    segment_index: int
    def __init__(self, speaker_identity: _Optional[str] = ..., segment_id: _Optional[str] = ..., language: _Optional[str] = ..., translated: _Optional[bool] = ..., text: _Optional[str] = ..., is_final: _Optional[bool] = ..., utterance_id: _Optional[str] = ..., segment_index: _Optional[int] = ...) -> None: ...
