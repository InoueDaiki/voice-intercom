"""REST API のモデル。OpenAPI と、TypeScript のクライアントの生成元になる。"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# LiveKit のルーム名にそのまま使う
RoomId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ルームの ID")]
RoomName = Annotated[str, Field(min_length=1, max_length=100, description="ルームの表示名")]
MemberIds = Annotated[
    list[str], Field(description="メンバーの user_id(Cognito の sub)。返すときは user_id の順")
]
DisplayName = Annotated[str, Field(min_length=1, max_length=50, description="表示名")]

# gpt-realtime-translate が出力できる13言語。
# services/agent/src/voice_intercom_agent/languages.py の LANGUAGE_NAMES と揃える(テストで確かめる)
Language = Literal["es", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it", "en"]

Timestamp = Annotated[str, Field(description="ISO 8601(UTC)")]


# 作った人がオーナーになる。connect は申請(connect.py)でしか作れない
RoomKind = Literal["public", "private", "connect"]
CreatableRoomKind = Literal["public", "private"]
# ルームの役割。オーナーは複数人いてよい
MemberRole = Literal["owner", "member"]
# 英小文字・数字・ハイフン。運営者が付け、Connect の申請で相手に伝える
TenantId = Annotated[
    str, Field(pattern=r"^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$", description="テナントの ID")
]
TenantName = Annotated[str, Field(min_length=1, max_length=100, description="テナントの表示名")]


class Room(BaseModel):
    room_id: RoomId
    name: RoomName
    kind: RoomKind
    tenant_id: str = Field(description="ルームを作ったテナント(Connect では申請した側)")
    connect_tenant_id: str | None = Field(
        default=None,
        description="Connect の相手のテナント(申請を受けた側)。Connect でなければ null",
    )
    connect_status: Literal["pending", "active"] | None = Field(
        default=None, description="Connect の申請中(pending)か、受けられた(active)か"
    )
    member_ids: MemberIds
    owner_ids: Annotated[list[str], Field(description="オーナーの user_id(user_id の順)")]
    archived_at: Timestamp | None = Field(default=None, description="アーカイブした時刻")
    deleting_at: Timestamp | None = Field(
        default=None,
        description="削除を始めた時刻。後始末が終わるまでの間だけあり、管理者にだけ見える"
        "(DELETE をやり直す)",
    )
    created_at: Timestamp
    updated_at: Timestamp


class RoomList(BaseModel):
    items: list[Room]


class CreateRoomRequest(BaseModel):
    name: RoomName
    kind: CreatableRoomKind
    member_ids: MemberIds = Field(
        default=[], description="一緒にメンバーにする人(同じテナントの人)。作った人は入れなくてよい"
    )


class UpdateRoomRequest(BaseModel):
    # 省略した(null の)項目は変えない
    name: RoomName | None = None
    kind: CreatableRoomKind | None = Field(
        default=None, description="Public と Private の間でだけ変えられる"
    )


class RoomMember(BaseModel):
    user_id: str
    role: MemberRole
    tenant_id: str = Field(description="その人のテナント")
    display_name: str | None = Field(description="表示名。プロフィールが無ければ null")


class RoomMemberList(BaseModel):
    items: list[RoomMember]


class PutRoomMemberRequest(BaseModel):
    role: MemberRole = "member"


class SetAudioRequest(BaseModel):
    enabled: bool = Field(description="マイクとスピーカーを使うか(音声をつないでいるか)")


class Tenant(BaseModel):
    tenant_id: str = Field(description="テナントの ID")
    name: str = Field(description="テナントの表示名")
    created_at: Timestamp


class TenantList(BaseModel):
    items: list[Tenant]


class CreateTenantRequest(BaseModel):
    tenant_id: TenantId
    name: TenantName


class SetUserTenantRequest(BaseModel):
    tenant_id: TenantId | None = Field(description="入れるテナント。null なら所属を外す")


class CreateConnectRequest(BaseModel):
    tenant_id: TenantId = Field(description="相手のテナント")
    name: RoomName


class ConnectRequest(BaseModel):
    """Connect の申請(申請中の Connect のルーム)。"""

    room: Room
    direction: Literal["outgoing", "incoming"] = Field(
        description="自分のテナントが申請した(outgoing)か、受けた(incoming)か"
    )
    from_tenant_name: str = Field(description="申請したテナントの表示名")
    to_tenant_name: str = Field(description="申請を受けたテナントの表示名")


class ConnectRequestList(BaseModel):
    items: list[ConnectRequest]


class User(BaseModel):
    user_id: str = Field(description="Cognito の sub")
    display_name: DisplayName
    language: Language = Field(description="話す言語。翻訳音声もこの言語で聞く")
    tenant_id: str | None = Field(default=None, description="所属するテナント。運営者が決める")
    created_at: Timestamp
    updated_at: Timestamp


class UserList(BaseModel):
    items: list[User]


class PutUserRequest(BaseModel):
    display_name: DisplayName
    language: Language
