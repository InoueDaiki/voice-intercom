"""REST API のモデル。OpenAPI と、TypeScript のクライアントの生成元になる。"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# LiveKit のルーム名にそのまま使う
RoomId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ルームの ID")]
RoomName = Annotated[str, Field(min_length=1, max_length=100, description="ルームの表示名")]
MemberIds = Annotated[list[str], Field(description="メンバーの user_id(Cognito の sub)")]
DisplayName = Annotated[str, Field(min_length=1, max_length=50, description="表示名")]

# gpt-realtime-translate が出力できる13言語。
# services/agent/src/voice_intercom_agent/languages.py の LANGUAGE_NAMES と揃える(テストで確かめる)
Language = Literal["es", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it", "en"]

Timestamp = Annotated[str, Field(description="ISO 8601(UTC)")]


class Room(BaseModel):
    room_id: RoomId
    name: RoomName
    member_ids: MemberIds
    created_at: Timestamp
    updated_at: Timestamp


class RoomList(BaseModel):
    items: list[Room]


class CreateRoomRequest(BaseModel):
    room_id: RoomId
    name: RoomName
    member_ids: MemberIds = []


class UpdateRoomRequest(BaseModel):
    # 省略した(null の)項目は変えない
    name: RoomName | None = None
    member_ids: MemberIds | None = None


class User(BaseModel):
    user_id: str = Field(description="Cognito の sub")
    display_name: DisplayName
    language: Language = Field(description="話す言語。翻訳音声もこの言語で聞く")
    created_at: Timestamp
    updated_at: Timestamp


class UserList(BaseModel):
    items: list[User]


class PutUserRequest(BaseModel):
    display_name: DisplayName
    language: Language
