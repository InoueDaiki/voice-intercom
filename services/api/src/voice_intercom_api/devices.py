"""push 通知の端末トークンの登録と解除(本人だけ)。app.py が include_router で取り込む。

解除も登録と同じ `/users/me/devices` にし、トークンは本文で渡す(`DELETE` + `{token}`)。
- FCM のトークンは長く(150〜200文字ほど。上限の定めはない)、`:` などを含む。パスに入れると
  クライアントごとのエンコードの違いに気を使ううえ、URL はログや中継に残りやすい。
  トークンを知っていれば、その端末に通知を送れるので、URL には出さない。
- OpenAPI 3.1 は DELETE の本文を書けて、生成するクライアント(TypeScript、Dart)も送れる。
保存の形と、持ち主の変更・上限の扱いは device_store.py を参照。
"""

from typing import Annotated

from aws_lambda_powertools.event_handler import Response
from aws_lambda_powertools.event_handler.openapi.params import Body
from aws_lambda_powertools.event_handler.openapi.types import (
    OpenAPIResponse,
    OpenAPIResponseContentModel,
    OpenAPIResponseContentSchema,
)
from aws_lambda_powertools.event_handler.router import APIGatewayHttpRouter
from pydantic import BaseModel, Field

from voice_intercom_api import device_store
from voice_intercom_api.auth import CurrentUser
from voice_intercom_api.device_store import Platform

router = APIGatewayHttpRouter()

_AUTH = [{"bearerAuth": []}]

# FCM の登録トークン。形は公開されていないので、空白と制御文字を含まないことだけを確かめる
FcmToken = Annotated[
    str,
    Field(
        min_length=1,
        max_length=4096,
        pattern=r"^[\x21-\x7e]+$",
        description="FCM の登録トークン(firebase_messaging の getToken())",
    ),
]


class RegisterDeviceRequest(BaseModel):
    token: FcmToken
    platform: Platform = Field(description="端末の OS。通知の送り方(優先度)を分ける")


class UnregisterDeviceRequest(BaseModel):
    token: FcmToken


def _no_content(description: str) -> dict[int, OpenAPIResponse]:
    """204 と、401・403 の応答。

    エラーの本文の型(ErrorResponse)は app.py にあり、ここから import すると循環するので、
    スキーマの名前で参照する(app.py の他のルートが使うので、components には必ずある)。
    """
    error: dict[str, OpenAPIResponseContentSchema | OpenAPIResponseContentModel] = {
        "application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}
    }
    return {
        204: {"description": description, "content": {}},
        401: {"description": "トークンがない、または不正", "content": error},
        403: {"description": "このトークンでは使えない", "content": error},
    }


@router.put(
    "/users/me/devices",
    summary=(
        "自分の端末トークンを登録する。アプリの起動時とトークンの更新時に呼ぶ。"
        f"1人 {device_store.MAX_DEVICES} 台までで、超えたら最後の登録がいちばん古い端末を外す。"
        "同じトークンを別の人が登録していたら、その人から外す"
    ),
    operation_id="registerMyDevice",
    tags=["users"],
    security=_AUTH,
    status_code=204,
    responses=_no_content("登録した"),
)
def register_my_device(
    body: Annotated[RegisterDeviceRequest, Body()], user: CurrentUser
) -> Response[str]:
    device_store.register(user.sub, body.token, body.platform)
    return Response(status_code=204, body="", content_type=None)


@router.delete(
    "/users/me/devices",
    summary="自分の端末トークンを外す(ログアウトのとき)。登録されていなくても 204",
    operation_id="unregisterMyDevice",
    tags=["users"],
    security=_AUTH,
    status_code=204,
    responses=_no_content("外した"),
)
def unregister_my_device(
    body: Annotated[UnregisterDeviceRequest, Body()], user: CurrentUser
) -> Response[str]:
    device_store.unregister(user.sub, body.token)
    return Response(status_code=204, body="", content_type=None)
