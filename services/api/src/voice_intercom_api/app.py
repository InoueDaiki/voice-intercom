"""API Gateway(HTTP API)から呼ばれる Lambda のエントリーポイント。

Pydantic のモデルを正にして、ここから OpenAPI を出す(`voice_intercom_api.openapi`)。
"""

from datetime import timedelta
from typing import Annotated

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, DependencyResolutionError
from aws_lambda_powertools.event_handler.exceptions import ServiceError
from aws_lambda_powertools.event_handler.openapi.models import HTTPBearer
from aws_lambda_powertools.event_handler.openapi.params import Body
from aws_lambda_powertools.event_handler.openapi.types import OpenAPIResponse
from aws_lambda_powertools.utilities.typing import LambdaContext
from livekit import api as livekit
from pydantic import BaseModel, Field

from voice_intercom_api.auth import CurrentUser
from voice_intercom_api.config import get_settings

# アプリは接続直後に使うだけで、接続後のトークンは LiveKit サーバーが更新する
LIVEKIT_TOKEN_TTL = timedelta(minutes=15)

app = APIGatewayHttpResolver(enable_validation=True)
app.configure_openapi(
    title="voice-intercom API",
    version="0.1.0",
    security_schemes={"bearerAuth": HTTPBearer(bearerFormat="JWT")},
)

_AUTH = [{"bearerAuth": []}]
_AUTH_ERRORS: dict[int, OpenAPIResponse] = {
    401: {"description": "トークンがない、または不正"},
    403: {"description": "このトークンでは使えない"},
}


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


class LiveKitTokenRequest(BaseModel):
    room_name: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$", description="入るルームの名前")


class LiveKitTokenResponse(BaseModel):
    server_url: str = Field(description="接続先の LiveKit の URL")
    participant_token: str = Field(description="LiveKit の参加用トークン")


@app.post(
    "/livekit/token",
    summary="LiveKit の参加用トークンを発行する",
    operation_id="createLiveKitToken",
    tags=["livekit"],
    security=_AUTH,
    responses=_AUTH_ERRORS,
)
def create_livekit_token(
    body: Annotated[LiveKitTokenRequest, Body()], user: CurrentUser
) -> LiveKitTokenResponse:
    # TODO: ルームに入れるかの判定(ルームの所属や管理者の権限)は、ルームの管理 API と一緒に作る
    settings = get_settings()
    token = (
        livekit.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        # 表示名は入れない(Cognito の username は UUID)。プロフィールは users テーブルに持つ
        .with_identity(user.sub)
        .with_ttl(LIVEKIT_TOKEN_TTL)
        .with_grants(livekit.VideoGrants(room_join=True, room=body.room_name))
        .to_jwt()
    )
    return LiveKitTokenResponse(server_url=settings.livekit_client_url, participant_token=token)


def handler(event: dict, context: LambdaContext) -> dict:
    return app.resolve(event, context)
