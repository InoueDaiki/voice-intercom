from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class TextMessage(_message.Message):
    __slots__ = ("message_id", "text")
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    text: str
    def __init__(self, message_id: _Optional[str] = ..., text: _Optional[str] = ...) -> None: ...
