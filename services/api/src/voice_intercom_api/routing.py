"""ルートの定義で共通に使うもの(OpenAPI の応答、パスの引数、ルームの権限の確認)。

app.py と、Router に分けたモジュール(timeline.py、media.py など)の両方から使う。
app.py に置くと、Router のモジュールが app.py を読むことになり、循環 import になるので分けた。
"""

from dataclasses import dataclass
from http import HTTPStatus
from typing import Annotated

from aws_lambda_powertools.event_handler.exceptions import (
    ForbiddenError,
    NotFoundError,
    ServiceError,
)
from aws_lambda_powertools.event_handler.openapi.params import Path
from aws_lambda_powertools.event_handler.openapi.types import OpenAPIResponse
from pydantic import BaseModel

from voice_intercom_api import room_cleanup, store
from voice_intercom_api.auth import Principal
from voice_intercom_api.models import Room

AUTH = [{"bearerAuth": []}]


class ErrorResponse(BaseModel):
    """エラーの本文(Powertools の ServiceError が返す形)。"""

    statusCode: int  # noqa: N815
    message: str


def responses(
    model: type[BaseModel] | None,
    *,
    status: int = 200,
    description: str = "成功",
    errors: dict[int, str] | None = None,
) -> dict[int, OpenAPIResponse]:
    """OpenAPI の応答。401 と 403 は必ず付ける。

    Powertools は responses を渡すと成功の応答を出さず、content のない応答に戻り値の型を付けるので、
    成功の応答も含めてすべて明示する。
    """
    ok: OpenAPIResponse = {"description": description, "content": {}}
    if model is not None:
        ok["content"] = {"application/json": {"model": model}}
    descriptions = {
        401: "トークンがない、または不正",
        403: "このトークンでは使えない",
    } | (errors or {})
    result: dict[int, OpenAPIResponse] = {status: ok}
    for code, d in sorted(descriptions.items()):
        result[code] = {
            "description": d,
            "content": {"application/json": {"model": ErrorResponse}},
        }
    return result


ROOM_NOT_FOUND = {404: "ルームがない"}

RoomIdPath = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ルームの ID")]


def existing_room(room_id: str) -> Room:
    """ルームを返す。なければ、消している途中なら 404。"""
    room = store.get_room(room_id)
    if room is None or room.deleting_at is not None:
        raise NotFoundError("ルームがない")
    return room


def is_member(room: Room, user_id: str) -> bool:
    """メンバーの行があり、その行のテナントが今の所属と同じか。

    所属を変えたら tenants.py がメンバーの行を外すが、途中で失敗したときや、前からある行でも
    使えないよう、ここでも確かめる。移す前の行(テナントが無い)は、ルームを作ったテナントの人。
    Connect でも、行のテナントを見るので、相手のテナントに移った人は入れない。
    """
    if user_id not in room.member_ids:
        return False
    home = store.member_tenant(room.room_id, user_id) or room.tenant_id
    return store.tenant_of(user_id) == home


def visible_room(room_id: str, user: Principal) -> Room:
    """今の所属のメンバーなら、ルームを返す(読むとき。アーカイブしたルームも読める)。

    管理者もメンバーでなければ読めない(docs/設計メモ.md の「テナントとルームの種別」)。
    申請中の Connect は 409。
    """
    room = existing_room(room_id)
    if not is_member(room, user.sub):
        raise ForbiddenError("このルームのメンバーではない")
    if room.connect_status == "pending":
        raise ServiceError(HTTPStatus.CONFLICT, "Connect の申請中")
    return room


def writable_room(room_id: str, user: Principal) -> Room:
    """メンバーで、アーカイブしていなければ、ルームを返す(入る・送る・消すとき)。"""
    room = visible_room(room_id, user)
    if room.archived_at is not None:
        raise ServiceError(HTTPStatus.CONFLICT, "アーカイブしたルーム")
    return room


def agent_writable_room(room_id: str) -> Room:
    """Agent が履歴や通知を書けるルームを返す。アーカイブしたルームは 409。

    発行済みのトークンで入り直すと、LiveKit はルームを作り直し、Agent も割り当てる。ここに
    来るのはそのときなので、LiveKit のルームを閉じて全員を切る(docs/設計メモ.md の
    「メンバーを外したとき・ルームを消したときの後始末」)。
    """
    room = existing_room(room_id)
    if room.archived_at is not None:
        room_cleanup.close_livekit_room(room_id)
        raise ServiceError(HTTPStatus.CONFLICT, "アーカイブしたルーム")
    return room


ROOM_READ_ERRORS = ROOM_NOT_FOUND | {409: "Connect の申請中"}
ROOM_WRITE_ERRORS = ROOM_NOT_FOUND | {409: "Connect の申請中か、アーカイブしたルーム"}
AGENT_WRITE_ERRORS = ROOM_NOT_FOUND | {409: "アーカイブしたルーム"}


@dataclass(frozen=True)
class Actor:
    """テナントに所属する利用者。"""

    user: Principal
    tenant_id: str

    @property
    def sub(self) -> str:
        return self.user.sub


def tenant_actor(user: Principal) -> Actor:
    """利用者のテナントを読む(users の行を1件)。所属が無ければ 403。"""
    tenant_id = store.tenant_of(user.sub)
    if not tenant_id:
        raise ForbiddenError("テナントに所属していない")
    return Actor(user=user, tenant_id=tenant_id)


def room_tenants(room: Room) -> set[str]:
    """ルームに関わるテナント(作ったテナントと、Connect の相手)。"""
    return {room.tenant_id} | ({room.connect_tenant_id} if room.connect_tenant_id else set())


def can_manage(room: Room, actor: Actor) -> bool:
    """オーナーか、ルームに関わるテナントの管理者か。"""
    if actor.tenant_id not in room_tenants(room):
        return False
    return actor.user.is_admin or (actor.sub in room.owner_ids and is_member(room, actor.sub))


def managed_room(room_id: str, actor: Actor) -> Room:
    """オーナーか管理者なら、ルームを返す。変えられるのは、自分のテナントの人だけ。"""
    room = existing_room(room_id)
    if not can_manage(room, actor):
        raise ForbiddenError("ルームのオーナーか管理者の権限が要る")
    return room
