"""API Gateway(HTTP API)から呼ばれる Lambda のエントリーポイント。

Pydantic のモデルを正にして、ここから OpenAPI を出す(`voice_intercom_api.openapi`)。
"""

from datetime import timedelta
from http import HTTPStatus
from typing import Annotated

from aws_lambda_powertools.event_handler import (
    APIGatewayHttpResolver,
    DependencyResolutionError,
)
from aws_lambda_powertools.event_handler.exceptions import (
    NotFoundError,
    ServiceError,
)
from aws_lambda_powertools.event_handler.openapi.models import HTTPBearer
from aws_lambda_powertools.event_handler.openapi.params import Body
from aws_lambda_powertools.utilities.typing import LambdaContext
from livekit import api as livekit
from pydantic import BaseModel, Field

from voice_intercom_api import (
    agent_wake,
    connect,
    devices,
    media,
    notifications,
    participants,
    rooms,
    store,
    tenants,
    timeline,
)
from voice_intercom_api.auth import CurrentUser
from voice_intercom_api.config import get_settings
from voice_intercom_api.models import PutUserRequest, User, UserList
from voice_intercom_api.routing import AUTH as _AUTH
from voice_intercom_api.routing import ROOM_WRITE_ERRORS as _ROOM_WRITE_ERRORS
from voice_intercom_api.routing import responses as _responses
from voice_intercom_api.routing import tenant_actor as _tenant_actor
from voice_intercom_api.routing import writable_room as _writable_room

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
    summary="ユーザーの一覧。プロフィールを登録した人だけを返す",
    description="運営者にはすべての人(所属の無い人も)、それ以外の人には自分のテナントの人を返す"
    "(ルームに招待する相手を選ぶ)。",
    operation_id="listUsers",
    tags=["users"],
    security=_AUTH,
    responses=_responses(UserList),
)
def list_users(user: CurrentUser) -> UserList:
    if user.is_operator:
        return UserList(items=store.list_users())
    return UserList(items=store.list_users(_tenant_actor(user).tenant_id))


# LiveKit


class LiveKitTokenRequest(BaseModel):
    room_name: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="入るルームの名前")
    # 前のアプリは送らないので、音声をつなぐ(今までと同じ)とみなす
    audio: bool = Field(
        default=True,
        description="音声をつなぐ(マイクとスピーカーを使う)か。false ならデータだけでつなぐ",
    )


class LiveKitTokenResponse(BaseModel):
    server_url: str = Field(description="接続先の LiveKit の URL")
    participant_token: str = Field(description="LiveKit の参加用トークン")


@app.post(
    "/livekit/token",
    summary="LiveKit の参加用トークンを発行する(ルームのメンバー)",
    description="参加者の属性に language と audio(on か off)を入れる。",
    operation_id="createLiveKitToken",
    tags=["livekit"],
    security=_AUTH,
    responses=_responses(
        LiveKitTokenResponse,
        errors=_ROOM_WRITE_ERRORS
        | {
            409: "プロフィール(表示名と言語)をまだ登録していない、Connect の申請中、"
            "アーカイブしたルーム"
        },
    ),
)
def create_livekit_token(
    body: Annotated[LiveKitTokenRequest, Body()], user: CurrentUser
) -> LiveKitTokenResponse:
    _writable_room(body.room_name, user)
    # 言語がないと、Agent はこの人を翻訳先に数えず、他の人にもこの人の言語が分からない。
    # 気づかないまま翻訳なしで入ってしまうより、先にプロフィールの登録を促す
    profile = store.get_user(user.sub)
    if profile is None:
        raise ServiceError(HTTPStatus.CONFLICT, "プロフィールをまだ登録していない")

    # dev では、使っていない間 0 台にしている Agent を起こす(agent_wake.py)
    agent_wake.wake()

    settings = get_settings()
    token = (
        livekit.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(user.sub)
        .with_name(profile.display_name)
        # Agent は参加者の属性 language で翻訳先を決める(services/agent の README)
        # 音声をつないでいるか(participants.py)。つないだまま切り替えるときは API が変える
        .with_attributes(
            {
                LANGUAGE_ATTRIBUTE: profile.language,
                participants.AUDIO_ATTRIBUTE: participants.audio_value(body.audio),
            }
        )
        .with_ttl(LIVEKIT_TOKEN_TTL)
        .with_grants(livekit.VideoGrants(room_join=True, room=body.room_name))
        # Agent は明示ディスパッチ(services/agent の README)。トークンのディスパッチは
        # ルームを作るときにしか効かないので、だれが最初に入ってもよいよう全員のトークンに入れる
        .with_room_config(
            livekit.RoomConfiguration(
                agents=[livekit.RoomAgentDispatch(agent_name=settings.agent_name)]
            )
        )
        .to_jwt()
    )
    return LiveKitTokenResponse(server_url=settings.livekit_client_url, participant_token=token)


# 機能ごとに Router に分けたルート
app.include_router(rooms.router)
app.include_router(connect.router)
app.include_router(tenants.router)
app.include_router(timeline.router)
app.include_router(media.router)
app.include_router(devices.router)
app.include_router(notifications.router)


def handler(event: dict, context: LambdaContext) -> dict:
    return app.resolve(event, context)
