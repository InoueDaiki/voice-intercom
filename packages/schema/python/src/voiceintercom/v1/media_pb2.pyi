from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class MediaMessage(_message.Message):
    __slots__ = ("event_id", "sender_identity", "occurred_at", "media_id", "content_type", "url", "thumbnail_url", "size_bytes", "text", "text_truncated", "language")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    SENDER_IDENTITY_FIELD_NUMBER: _ClassVar[int]
    OCCURRED_AT_FIELD_NUMBER: _ClassVar[int]
    MEDIA_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    THUMBNAIL_URL_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    TEXT_TRUNCATED_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    sender_identity: str
    occurred_at: str
    media_id: str
    content_type: str
    url: str
    thumbnail_url: str
    size_bytes: int
    text: str
    text_truncated: bool
    language: str
    def __init__(self, event_id: _Optional[str] = ..., sender_identity: _Optional[str] = ..., occurred_at: _Optional[str] = ..., media_id: _Optional[str] = ..., content_type: _Optional[str] = ..., url: _Optional[str] = ..., thumbnail_url: _Optional[str] = ..., size_bytes: _Optional[int] = ..., text: _Optional[str] = ..., text_truncated: _Optional[bool] = ..., language: _Optional[str] = ...) -> None: ...
