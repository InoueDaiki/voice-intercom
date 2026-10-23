"""ルームとメンバーの API。

docs/設計メモ.md の「テナントとルームの種別」。
- ルームは誰でも作れ、作った人がオーナーになる(Public か Private。Connect は connect.py の
  申請で作る)。
- Public には、同じテナントの誰でも参加できる(POST .../join)。Private と Connect には、オーナーか
  管理者が足した人だけが入る(PUT .../members/{user_id}。承諾は待たない)。
- オーナーと管理者が変えられるのは、自分のテナントの人だけ(Connect では相手のテナントの人を
  変えない)。
- 誰でも抜けられる(DELETE .../members/{自分})が、最後のオーナーは抜けられない。外す・メンバーに戻す
  ときも同じ。代わりにアーカイブする(POST .../archive)。
"""

import secrets
from http import HTTPStatus
from typing import Annotated, Literal

from aws_lambda_powertools.event_handler import Response
from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import (
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    ServiceError,
)
from aws_lambda_powertools.event_handler.openapi.params import Body, Path, Query

from voice_intercom_api import participants, room_cleanup, store
from voice_intercom_api.auth import CurrentUser
from voice_intercom_api.models import (
    CreateRoomRequest,
    PutRoomMemberRequest,
    Room,
    RoomList,
    RoomMemberList,
    SetAudioRequest,
    UpdateRoomRequest,
)
from voice_intercom_api.routing import (
    AUTH,
    ROOM_NOT_FOUND,
    ROOM_WRITE_ERRORS,
    Actor,
    RoomIdPath,
    can_manage,
    existing_room,
    managed_room,
    responses,
    tenant_actor,
    writable_room,
)

router = Router()

UserIdPath = Annotated[
    str, Path(min_length=1, max_length=128, description="user_id(Cognito の sub)")
]

LAST_OWNER = "最後のオーナーは抜けられない(ほかの人をオーナーにするか、アーカイブする)"


def new_room_id() -> str:
    """LiveKit のルーム名にも使う。テナントをまたいで重ならないよう乱数にする(12 文字)。"""
    return secrets.token_urlsafe(9)


def _not_pending(room: Room) -> None:
    if room.connect_status == "pending":
        raise ServiceError(HTTPStatus.CONFLICT, "Connect の申請中")


def _is_last_owner(room: Room, user_id: str) -> bool:
    return room.owner_ids == [user_id]


def _check_same_tenant(user_ids: list[str], tenant_id: str) -> None:
    """足す人が、みなプロフィールを登録した同じテナントの人か。"""
    users = store.get_users(user_ids)
    others = [
        uid for uid in user_ids if users.get(uid) is None or users[uid].tenant_id != tenant_id
    ]
    if others:
        raise BadRequestError(f"自分のテナントの人だけを足せる: {', '.join(sorted(others))}")


# 一覧・作成


@router.get(
    "/rooms",
    summary="ルームの一覧",
    description="scope が member(既定)なら自分がメンバーのルーム(アーカイブしたものも)、"
    "joinable なら自分のテナントの Public のうち参加していないもの、"
    "tenant なら自分のテナントに関わるすべてのルーム(管理者。申請中の Connect も)を"
    "名前の順に返す。",
    operation_id="listRooms",
    tags=["rooms"],
    security=AUTH,
    responses=responses(RoomList),
)
def list_rooms(
    user: CurrentUser,
    scope: Annotated[
        Literal["member", "joinable", "tenant"], Query(description="どのルームを返すか")
    ] = "member",
) -> RoomList:
    if scope == "member":
        return RoomList(items=store.list_member_rooms(user.sub))
    actor = tenant_actor(user)
    if scope == "joinable":
        return RoomList(items=store.list_joinable_rooms(actor.tenant_id, actor.sub))
    if not user.is_admin:
        raise ForbiddenError("管理者の権限が要る")
    return RoomList(items=store.list_tenant_rooms(actor.tenant_id))


@router.post(
    "/rooms",
    summary="ルームを作る。作った人がオーナーになる",
    description="member_ids は同じテナントの人だけ。"
    "Connect はここでは作れない(POST /connect-requests)。",
    operation_id="createRoom",
    tags=["rooms"],
    security=AUTH,
    status_code=201,
    responses=responses(
        Room, status=201, description="作った", errors={400: "ほかのテナントの人が入っている"}
    ),
)
def create_room(body: Annotated[CreateRoomRequest, Body()], user: CurrentUser) -> Room:
    actor = tenant_actor(user)
    member_ids = [uid for uid in dict.fromkeys(body.member_ids) if uid != actor.sub]
    _check_same_tenant(member_ids, actor.tenant_id)
    return store.create_room(
        new_room_id(),
        body.name,
        member_ids,
        tenant_id=actor.tenant_id,
        kind=body.kind,
        owner_ids=[actor.sub],
    )


# 1つのルーム


@router.get(
    "/rooms/<room_id>",
    summary="ルームを取る(メンバー、オーナーか管理者、同じテナントの Public なら誰でも)",
    operation_id="getRoom",
    tags=["rooms"],
    security=AUTH,
    responses=responses(Room, errors=ROOM_NOT_FOUND),
)
def get_room(room_id: RoomIdPath, user: CurrentUser) -> Room:
    room = existing_room(room_id)
    if user.sub in room.member_ids:
        return room
    actor = tenant_actor(user)
    # 参加する前に、Public の名前と人数を見られる
    if can_manage(room, actor) or (room.kind == "public" and room.tenant_id == actor.tenant_id):
        return room
    raise ForbiddenError("このルームのメンバーではない")


@router.patch(
    "/rooms/<room_id>",
    summary="ルームの名前と種別を変える(オーナーか管理者)",
    description="種別は Public と Private の間でだけ変えられる。",
    operation_id="updateRoom",
    tags=["rooms"],
    security=AUTH,
    responses=responses(Room, errors=ROOM_NOT_FOUND | {400: "Connect の種別は変えられない"}),
)
def update_room(
    room_id: RoomIdPath, body: Annotated[UpdateRoomRequest, Body()], user: CurrentUser
) -> Room:
    room = managed_room(room_id, tenant_actor(user))
    if body.kind is not None and room.kind == "connect":
        raise BadRequestError("Connect の種別は変えられない")
    values = {k: v for k, v in {"name": body.name, "kind": body.kind}.items() if v is not None}
    try:
        return store.update_room(room_id, **values)
    except store.NotFoundError as e:
        raise NotFoundError("ルームがない") from e


@router.delete(
    "/rooms/<room_id>",
    summary="ルームを消す(ルームを作ったテナントの管理者)",
    description="LiveKit のルームにいる全員を切り、履歴とメディアも消す。",
    operation_id="deleteRoom",
    tags=["rooms"],
    security=AUTH,
    status_code=204,
    responses=responses(None, status=204, description="消した", errors=ROOM_NOT_FOUND),
)
def delete_room(room_id: RoomIdPath, user: CurrentUser) -> Response[str]:
    if not user.is_admin:
        raise ForbiddenError("管理者の権限が要る")
    actor = tenant_actor(user)
    room = store.get_room(room_id)
    if room is None:
        # 前の DELETE の後始末が途中で終わっていても、やり直せるようにする
        room_cleanup.after_delete(room_id)
        raise NotFoundError("ルームがない")
    if room.tenant_id != actor.tenant_id:
        raise ForbiddenError("ルームを作ったテナントの管理者だけが消せる")
    try:
        store.delete_room(room_id)
    except store.NotFoundError as e:
        raise NotFoundError("ルームがない") from e
    # LiveKit のルームを消して全員を切り、履歴とメディアを消す(room_cleanup.py)
    room_cleanup.after_delete(room_id)
    return Response(status_code=204, body="", content_type=None)


@router.post(
    "/rooms/<room_id>/join",
    summary="Public のルームに参加する(同じテナントの人)。参加していれば何もしない",
    operation_id="joinRoom",
    tags=["rooms"],
    security=AUTH,
    responses=responses(
        Room, errors=ROOM_NOT_FOUND | {409: "アーカイブしたルーム"}, description="参加した"
    ),
)
def join_room(room_id: RoomIdPath, user: CurrentUser) -> Room:
    actor = tenant_actor(user)
    room = existing_room(room_id)
    if actor.sub in room.member_ids:
        return room
    if room.kind != "public" or room.tenant_id != actor.tenant_id:
        raise ForbiddenError("招待された人だけが入れるルーム")
    if room.archived_at is not None:
        raise ServiceError(HTTPStatus.CONFLICT, "アーカイブしたルーム")
    store.put_member(room_id, actor.sub, role="member", tenant_id=actor.tenant_id)
    return existing_room(room_id)


# メンバー


@router.get(
    "/rooms/<room_id>/members",
    summary="メンバーの一覧(メンバー、オーナーか管理者)",
    operation_id="listRoomMembers",
    tags=["rooms"],
    security=AUTH,
    responses=responses(RoomMemberList, errors=ROOM_NOT_FOUND),
)
def list_room_members(room_id: RoomIdPath, user: CurrentUser) -> RoomMemberList:
    room = existing_room(room_id)
    if user.sub not in room.member_ids and not can_manage(room, tenant_actor(user)):
        raise ForbiddenError("このルームのメンバーではない")
    return RoomMemberList(items=store.room_members(room_id))


def _member_tenant(room_id: str, user_id: str) -> str | None:
    """メンバーの行のテナント。メンバーでなければ None。"""
    for m in store.members_of(room_id):
        if m.user_id == user_id:
            return m.tenant_id
    return None


def _check_own_side(room: Room, actor: Actor, user_id: str) -> None:
    """そのメンバーを、自分が変えてよいか(自分のテナントの人か)。"""
    tenant_id = _member_tenant(room.room_id, user_id)
    # 移す前の行(テナントが無い)は、ルームを作ったテナントの人として扱う
    if (tenant_id or room.tenant_id) != actor.tenant_id:
        raise ForbiddenError("自分のテナントの人だけを変えられる")


@router.put(
    "/rooms/<room_id>/members/<user_id>",
    summary="メンバーに足すか、役割(オーナーかメンバー)を変える(オーナーか管理者)",
    description="足せるのは、プロフィールを登録した自分のテナントの人だけ。承諾は待たずにメンバーになる。"
    "最後のオーナーをメンバーに戻すと 409。",
    operation_id="putRoomMember",
    tags=["rooms"],
    security=AUTH,
    responses=responses(
        Room,
        errors=ROOM_NOT_FOUND
        | {400: "自分のテナントの人ではない", 409: "最後のオーナー、または Connect の申請中"},
    ),
)
def put_room_member(
    room_id: RoomIdPath,
    user_id: UserIdPath,
    body: Annotated[PutRoomMemberRequest, Body()],
    user: CurrentUser,
) -> Room:
    actor = tenant_actor(user)
    room = managed_room(room_id, actor)
    _not_pending(room)
    if user_id in room.member_ids:
        _check_own_side(room, actor, user_id)
    else:
        _check_same_tenant([user_id], actor.tenant_id)
    if body.role == "member" and _is_last_owner(room, user_id):
        raise ServiceError(HTTPStatus.CONFLICT, LAST_OWNER)
    store.put_member(room_id, user_id, role=body.role, tenant_id=actor.tenant_id)
    return existing_room(room_id)


@router.delete(
    "/rooms/<room_id>/members/<user_id>",
    summary="メンバーから外す。自分なら抜ける(誰でも)、ほかの人ならオーナーか管理者",
    description="最後のオーナーは抜けられない(409)。外した人が LiveKit のルームにいれば出す。",
    operation_id="deleteRoomMember",
    tags=["rooms"],
    security=AUTH,
    status_code=204,
    responses=responses(
        None,
        status=204,
        description="外した",
        errors=ROOM_NOT_FOUND | {409: "最後のオーナー、または Connect の申請中"},
    ),
)
def delete_room_member(
    room_id: RoomIdPath, user_id: UserIdPath, user: CurrentUser
) -> Response[str]:
    room = existing_room(room_id)
    if user_id != user.sub:
        actor = tenant_actor(user)
        room = managed_room(room_id, actor)
        _check_own_side(room, actor, user_id)
    _not_pending(room)
    if user_id not in room.member_ids:
        raise NotFoundError("メンバーではない")
    if _is_last_owner(room, user_id):
        raise ServiceError(HTTPStatus.CONFLICT, LAST_OWNER)
    store.delete_member(room_id, user_id)
    # 接続中の人のトークンは LiveKit が更新し続けるので、外した人は LiveKit のルームから出す
    room_cleanup.evict(room_id, [user_id])
    return Response(status_code=204, body="", content_type=None)


# アーカイブ


@router.post(
    "/rooms/<room_id>/archive",
    summary="アーカイブする(オーナーか管理者)",
    description="読むだけのルームにし、LiveKit のルームにいる全員を切る。",
    operation_id="archiveRoom",
    tags=["rooms"],
    security=AUTH,
    responses=responses(Room, errors=ROOM_NOT_FOUND | {409: "Connect の申請中"}),
)
def archive_room(room_id: RoomIdPath, user: CurrentUser) -> Room:
    room = managed_room(room_id, tenant_actor(user))
    _not_pending(room)
    if room.archived_at is not None:
        return room
    room = store.update_room(room_id, archived_at=store.now())
    room_cleanup.close_livekit_room(room_id)
    return room


@router.delete(
    "/rooms/<room_id>/archive",
    summary="アーカイブを戻す(オーナーか管理者)",
    operation_id="unarchiveRoom",
    tags=["rooms"],
    security=AUTH,
    responses=responses(Room, errors=ROOM_NOT_FOUND),
)
def unarchive_room(room_id: RoomIdPath, user: CurrentUser) -> Room:
    room = managed_room(room_id, tenant_actor(user))
    if room.archived_at is None:
        return room
    return store.update_room(room_id, archived_at=store.REMOVE)


# 音声


@router.put(
    "/rooms/<room_id>/audio",
    summary="音声をつなぐ・切る(メンバー)。LiveKit の参加者の属性 audio を変える",
    description="ルームにつないだまま、マイクとスピーカーを使うかを Agent に知らせる"
    "(翻訳の音声と読み上げは、audio が on の人の言語にだけ作る)。"
    "マイクの publish と音声の購読は、アプリが自分で切り替える。",
    operation_id="setRoomAudio",
    tags=["rooms"],
    security=AUTH,
    status_code=204,
    responses=responses(
        None,
        status=204,
        description="変えた",
        errors=ROOM_WRITE_ERRORS | {409: "ルームにつないでいない、申請中、アーカイブした"},
    ),
)
def set_room_audio(
    room_id: RoomIdPath, body: Annotated[SetAudioRequest, Body()], user: CurrentUser
) -> Response[str]:
    writable_room(room_id, user)
    try:
        participants.set_audio(room_id, user.sub, body.enabled)
    except participants.NotInRoomError as e:
        raise ServiceError(HTTPStatus.CONFLICT, "ルームにつないでいない") from e
    return Response(status_code=204, body="", content_type=None)
