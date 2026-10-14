from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TextStatus(_message.Message):
    __slots__ = ("message_id", "state", "reason", "max_chars", "untranslated_languages", "unspoken_languages")
    class State(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STATE_UNSPECIFIED: _ClassVar[TextStatus.State]
        STATE_ACCEPTED: _ClassVar[TextStatus.State]
        STATE_REJECTED: _ClassVar[TextStatus.State]
        STATE_FAILED: _ClassVar[TextStatus.State]
        STATE_COMPLETED: _ClassVar[TextStatus.State]
    STATE_UNSPECIFIED: TextStatus.State
    STATE_ACCEPTED: TextStatus.State
    STATE_REJECTED: TextStatus.State
    STATE_FAILED: TextStatus.State
    STATE_COMPLETED: TextStatus.State
    class Reason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        REASON_UNSPECIFIED: _ClassVar[TextStatus.Reason]
        REASON_EMPTY: _ClassVar[TextStatus.Reason]
        REASON_TOO_LONG: _ClassVar[TextStatus.Reason]
    REASON_UNSPECIFIED: TextStatus.Reason
    REASON_EMPTY: TextStatus.Reason
    REASON_TOO_LONG: TextStatus.Reason
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    MAX_CHARS_FIELD_NUMBER: _ClassVar[int]
    UNTRANSLATED_LANGUAGES_FIELD_NUMBER: _ClassVar[int]
    UNSPOKEN_LANGUAGES_FIELD_NUMBER: _ClassVar[int]
    message_id: str
    state: TextStatus.State
    reason: TextStatus.Reason
    max_chars: int
    untranslated_languages: _containers.RepeatedScalarFieldContainer[str]
    unspoken_languages: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, message_id: _Optional[str] = ..., state: _Optional[_Union[TextStatus.State, str]] = ..., reason: _Optional[_Union[TextStatus.Reason, str]] = ..., max_chars: _Optional[int] = ..., untranslated_languages: _Optional[_Iterable[str]] = ..., unspoken_languages: _Optional[_Iterable[str]] = ...) -> None: ...
