"""ルートの定義で共通に使うもの(OpenAPI の応答、パスの引数、ルームの権限の確認)。

app.py と、Router に分けたモジュール(timeline.py、media.py など)の両方から使う。
app.py に置くと、Router のモジュールが app.py を読むことになり、循環 import になるので分けた。
"""

from typing import Annotated

from aws_lambda_powertools.event_handler.exceptions import ForbiddenError, NotFoundError
from aws_lambda_powertools.event_handler.openapi.params import Path
from aws_lambda_powertools.event_handler.openapi.types import OpenAPIResponse
from pydantic import BaseModel

from voice_intercom_api import store
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
    """ルームを返す。なければ 404。"""
    room = store.get_room(room_id)
    if room is None:
        raise NotFoundError("ルームがない")
    return room


def visible_room(room_id: str, user: Principal) -> Room:
    """管理者かメンバーなら、ルームを返す。"""
    room = existing_room(room_id)
    if not user.is_admin and user.sub not in room.member_ids:
        raise ForbiddenError("このルームのメンバーではない")
    return room
