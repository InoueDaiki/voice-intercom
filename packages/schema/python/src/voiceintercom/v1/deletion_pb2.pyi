from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class DeletionMessage(_message.Message):
    __slots__ = ("event_id", "sender_identity", "kind", "message_id", "deleted_at")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    SENDER_IDENTITY_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    sender_identity: str
    kind: str
    message_id: str
    deleted_at: str
    def __init__(self, event_id: _Optional[str] = ..., sender_identity: _Optional[str] = ..., kind: _Optional[str] = ..., message_id: _Optional[str] = ..., deleted_at: _Optional[str] = ...) -> None: ...
