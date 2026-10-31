"""Connect の申請の API(テナントの管理者)。

docs/設計メモ.md の「Connect の申請」。テナント A の管理者が、テナント B の ID を打って申請すると、
申請中(connect_status が pending)の Connect のルームができ、申請した人がオーナーになる。B の管理者が
受けると active になり、受けた人もオーナーになる。断る・取り下げると、ルームの行を消す。
"""

from typing import Annotated

from aws_lambda_powertools.event_handler import Response
from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import (
    BadRequestError,
    ForbiddenError,
    NotFoundError,
)
from aws_lambda_powertools.event_handler.openapi.params import Body

from voice_intercom_api import room_cleanup, store
from voice_intercom_api.auth import AdminUser
from voice_intercom_api.models import (
    ConnectRequest,
    ConnectRequestList,
    CreateConnectRequest,
    Room,
)
from voice_intercom_api.rooms import new_room_id
from voice_intercom_api.routing import (
    AUTH,
    Actor,
    RoomIdPath,
    existing_room,
    responses,
    tenant_actor,
)

router = Router()

REQUEST_NOT_FOUND = {404: "申請がない"}


def _request(room: Room, actor: Actor) -> ConnectRequest:
    def name(tenant_id: str | None) -> str:
        tenant = store.get_tenant(tenant_id) if tenant_id else None
        return tenant.name if tenant else (tenant_id or "")

    return ConnectRequest(
        room=room,
        direction="outgoing" if room.tenant_id == actor.tenant_id else "incoming",
        from_tenant_name=name(room.tenant_id),
        to_tenant_name=name(room.connect_tenant_id),
    )


def _pending_room(room_id: str, actor: Actor) -> Room:
    """自分のテナントが関わる、申請中の Connect のルーム。"""
    room = existing_room(room_id)
    if room.connect_status != "pending" or actor.tenant_id not in {
        room.tenant_id,
        room.connect_tenant_id,
    }:
        raise NotFoundError("申請がない")
    return room


@router.get(
    "/connect-requests",
    summary="Connect の申請の一覧(管理者)。自分のテナントが出したものと、受けたもの",
    operation_id="listConnectRequests",
    tags=["connect"],
    security=AUTH,
    responses=responses(ConnectRequestList),
)
def list_connect_requests(admin: AdminUser) -> ConnectRequestList:
    actor = tenant_actor(admin)
    rooms = [
        r
        for r in store.list_tenant_rooms(actor.tenant_id)
        if r.connect_status == "pending" and r.deleting_at is None
    ]
    return ConnectRequestList(items=[_request(r, actor) for r in rooms])


@router.post(
    "/connect-requests",
    summary="ほかのテナントに Connect を申請する(管理者)。申請した人がオーナーになる",
    operation_id="createConnectRequest",
    tags=["connect"],
    security=AUTH,
    status_code=201,
    responses=responses(
        ConnectRequest,
        status=201,
        description="申請した",
        errors={400: "自分のテナント", 404: "相手のテナントがない"},
    ),
)
def create_connect_request(
    body: Annotated[CreateConnectRequest, Body()], admin: AdminUser
) -> ConnectRequest:
    actor = tenant_actor(admin)
    if body.tenant_id == actor.tenant_id:
        raise BadRequestError("自分のテナントには申請できない")
    if store.get_tenant(body.tenant_id) is None:
        raise NotFoundError("相手のテナントがない")
    room = store.create_room(
        new_room_id(),
        body.name,
        tenant_id=actor.tenant_id,
        kind="connect",
        owner_ids=[actor.sub],
        connect_tenant_id=body.tenant_id,
    )
    return _request(room, actor)


@router.post(
    "/connect-requests/<room_id>/accept",
    summary="Connect の申請を受ける(申請を受けたテナントの管理者)。受けた人もオーナーになる",
    operation_id="acceptConnectRequest",
    tags=["connect"],
    security=AUTH,
    responses=responses(Room, errors=REQUEST_NOT_FOUND),
)
def accept_connect_request(room_id: RoomIdPath, admin: AdminUser) -> Room:
    actor = tenant_actor(admin)
    room = _pending_room(room_id, actor)
    if room.connect_tenant_id != actor.tenant_id:
        raise ForbiddenError("申請を受けたテナントの管理者だけが受けられる")
    store.put_member(room_id, actor.sub, role="owner", tenant_id=actor.tenant_id)
    try:
        return store.update_room(room_id, connect_status="active")
    except store.NotFoundError as e:
        raise NotFoundError("申請がない") from e


@router.delete(
    "/connect-requests/<room_id>",
    summary="Connect の申請を断る・取り下げる(どちらかのテナントの管理者)",
    operation_id="deleteConnectRequest",
    tags=["connect"],
    security=AUTH,
    status_code=204,
    responses=responses(None, status=204, description="消した", errors=REQUEST_NOT_FOUND),
)
def delete_connect_request(room_id: RoomIdPath, admin: AdminUser) -> Response[str]:
    actor = tenant_actor(admin)
    _pending_room(room_id, actor)
    try:
        store.delete_room(room_id)
    except store.NotFoundError as e:
        raise NotFoundError("申請がない") from e
    # 申請中は入れないので履歴は無いはずだが、念のため後始末をする。消すものが無いので、
    # rooms.py の DELETE のように行を残してやり直させることはしない
    room_cleanup.after_delete(room_id)
    return Response(status_code=204, body="", content_type=None)
