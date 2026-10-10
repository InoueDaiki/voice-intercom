"""API Gateway(HTTP API)から呼ばれる Lambda のエントリーポイント。

Pydantic のモデルを正にして、ここから OpenAPI を出す(`voice_intercom_api.openapi`)。
"""

from datetime import timedelta
from http import HTTPStatus
from typing import Annotated

from aws_lambda_powertools.event_handler import (
    APIGatewayHttpResolver,
    DependencyResolutionError,
    Response,
)
from aws_lambda_powertools.event_handler.exceptions import (
    ForbiddenError,
    NotFoundError,
    ServiceError,
)
from aws_lambda_powertools.event_handler.openapi.models import HTTPBearer
from aws_lambda_powertools.event_handler.openapi.params import Body, Path
from aws_lambda_powertools.event_handler.openapi.types import OpenAPIResponse
from aws_lambda_powertools.utilities.typing import LambdaContext
from livekit import api as livekit
from pydantic import BaseModel, Field

from voice_intercom_api import devices, store
from voice_intercom_api.auth import AdminUser, CurrentUser, Principal
from voice_intercom_api.config import get_settings
from voice_intercom_api.models import (
    CreateRoomRequest,
    PutUserRequest,
    Room,
    RoomList,
    UpdateRoomRequest,
    User,
    UserList,
)

# Agent が翻訳先を決めるのに使う、参加者の属性のキー(services/agent の languages.py)
LANGUAGE_ATTRIBUTE = "language"

# アプリは接続直後に使うだけで、接続後のトークンは LiveKit サーバーが更新する
LIVEKIT_TOKEN_TTL = timedelta(minutes=15)

app = APIGatewayHttpResolver(enable_validation=True)
app.configure_openapi(
    title="voice-intercom API",
    version="0.1.0",
    security_schemes={"bearerAuth": HTTPBearer(bearerFormat="JWT")},
)

_AUTH = [{"bearerAuth": []}]


class ErrorResponse(BaseModel):
    """エラーの本文(Powertools の ServiceError が返す形)。"""

    statusCode: int  # noqa: N815
    message: str


def _responses(
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
    responses: dict[int, OpenAPIResponse] = {status: ok}
    for code, d in sorted(descriptions.items()):
        responses[code] = {
            "description": d,
            "content": {"application/json": {"model": ErrorResponse}},
        }
    return responses


_ROOM_NOT_FOUND = {404: "ルームがない"}

RoomIdPath = Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="ルームの ID")]


@app.exception_handler(DependencyResolutionError)
def _unwrap_dependency_error(e: DependencyResolutionError) -> None:
    # Depends の中で投げた 401 などは DependencyResolutionError に包まれるので、元の例外に戻す
    if isinstance(e.__cause__, ServiceError):
        raise e.__cause__
    raise e


class HealthResponse(BaseModel):
    status: str


# API Gateway の public_routes(認証なし)に入っている
@app.get("/health", summary="死活監視", operation_id="getHealth", tags=["health"])
def health() -> HealthResponse:
    return HealthResponse(status="ok")


# ルーム


def _visible_room(room_id: str, user: Principal) -> Room:
    """管理者かメンバーなら、ルームを返す。"""
    room = store.get_room(room_id)
    if room is None:
        raise NotFoundError("ルームがない")
    if not user.is_admin and user.sub not in room.member_ids:
        raise ForbiddenError("このルームのメンバーではない")
    return room


@app.get(
    "/rooms",
    summary="ルームの一覧。管理者にはすべて、それ以外の人には自分がメンバーのルームを返す",
    operation_id="listRooms",
    tags=["rooms"],
    security=_AUTH,
    responses=_responses(RoomList),
)
def list_rooms(user: CurrentUser) -> RoomList:
    return RoomList(items=store.list_rooms(None if user.is_admin else user.sub))


@app.post(
    "/rooms",
    summary="ルームを作る(管理者)",
    operation_id="createRoom",
    tags=["rooms"],
    security=_AUTH,
    status_code=201,
    responses=_responses(
        Room, status=201, description="作った", errors={409: "同じ room_id のルームが既にある"}
    ),
)
def create_room(body: Annotated[CreateRoomRequest, Body()], _admin: AdminUser) -> Room:
    try:
        return store.create_room(body.room_id, body.name, body.member_ids)
    except store.AlreadyExistsError as e:
        raise ServiceError(HTTPStatus.CONFLICT, "同じ room_id のルームが既にある") from e


@app.get(
    "/rooms/<room_id>",
    summary="ルームを取る(管理者かメンバー)",
    operation_id="getRoom",
    tags=["rooms"],
    security=_AUTH,
    responses=_responses(Room, errors=_ROOM_NOT_FOUND),
)
def get_room(room_id: RoomIdPath, user: CurrentUser) -> Room:
    return _visible_room(room_id, user)


@app.patch(
    "/rooms/<room_id>",
    summary="ルームの名前とメンバーを変える(管理者)",
    operation_id="updateRoom",
    tags=["rooms"],
    security=_AUTH,
    responses=_responses(Room, errors=_ROOM_NOT_FOUND),
)
def update_room(
    room_id: RoomIdPath, body: Annotated[UpdateRoomRequest, Body()], _admin: AdminUser
) -> Room:
    try:
        return store.update_room(room_id, name=body.name, member_ids=body.member_ids)
    except store.NotFoundError as e:
        raise NotFoundError("ルームがない") from e


@app.delete(
    "/rooms/<room_id>",
    summary="ルームを消す(管理者)",
    operation_id="deleteRoom",
    tags=["rooms"],
    security=_AUTH,
    status_code=204,
    responses=_responses(None, status=204, description="消した", errors=_ROOM_NOT_FOUND),
)
def delete_room(room_id: RoomIdPath, _admin: AdminUser) -> Response[str]:
    try:
        store.delete_room(room_id)
    except store.NotFoundError as e:
        raise NotFoundError("ルームがない") from e
    return Response(status_code=204, body="", content_type=None)


# ユーザーのプロフィール


@app.get(
    "/users/me",
    summary="自分のプロフィールを取る",
    operation_id="getMyProfile",
    tags=["users"],
    security=_AUTH,
    responses=_responses(User, errors={404: "プロフィールをまだ登録していない"}),
)
def get_my_profile(user: CurrentUser) -> User:
    profile = store.get_user(user.sub)
    if profile is None:
        raise NotFoundError("プロフィールをまだ登録していない")
    return profile


@app.put(
    "/users/me",
    summary="自分のプロフィールを登録・更新する",
    operation_id="putMyProfile",
    tags=["users"],
    security=_AUTH,
    responses=_responses(User),
)
def put_my_profile(body: Annotated[PutUserRequest, Body()], user: CurrentUser) -> User:
    return store.put_user(user.sub, display_name=body.display_name, language=body.language)


@app.get(
    "/users",
    summary="ユーザーの一覧(管理者)。プロフィールを登録した人だけを返す",
    operation_id="listUsers",
    tags=["users"],
    security=_AUTH,
    responses=_responses(UserList),
)
def list_users(_admin: AdminUser) -> UserList:
    return UserList(items=store.list_users())


# LiveKit


class LiveKitTokenRequest(BaseModel):
    room_name: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="入るルームの名前")


class LiveKitTokenResponse(BaseModel):
    server_url: str = Field(description="接続先の LiveKit の URL")
    participant_token: str = Field(description="LiveKit の参加用トークン")


@app.post(
    "/livekit/token",
    summary="LiveKit の参加用トークンを発行する(管理者かルームのメンバー)",
    operation_id="createLiveKitToken",
    tags=["livekit"],
    security=_AUTH,
    responses=_responses(
        LiveKitTokenResponse,
        errors=_ROOM_NOT_FOUND | {409: "プロフィール(表示名と言語)をまだ登録していない"},
    ),
)
def create_livekit_token(
    body: Annotated[LiveKitTokenRequest, Body()], user: CurrentUser
) -> LiveKitTokenResponse:
    _visible_room(body.room_name, user)
    # 言語がないと、Agent はこの人を翻訳先に数えず、他の人にもこの人の言語が分からない。
    # 気づかないまま翻訳なしで入ってしまうより、先にプロフィールの登録を促す
    profile = store.get_user(user.sub)
    if profile is None:
        raise ServiceError(HTTPStatus.CONFLICT, "プロフィールをまだ登録していない")

    settings = get_settings()
    token = (
        livekit.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(user.sub)
        .with_name(profile.display_name)
        # Agent は参加者の属性 language で翻訳先を決める(services/agent の README)
        .with_attributes({LANGUAGE_ATTRIBUTE: profile.language})
        .with_ttl(LIVEKIT_TOKEN_TTL)
        .with_grants(livekit.VideoGrants(room_join=True, room=body.room_name))
        .to_jwt()
    )
    return LiveKitTokenResponse(server_url=settings.livekit_client_url, participant_token=token)


# 別のモジュールに分けたルート
app.include_router(devices.router)


def handler(event: dict, context: LambdaContext) -> dict:
    return app.resolve(event, context)
