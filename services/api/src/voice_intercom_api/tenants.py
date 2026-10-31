"""テナントの API(運営者)。

docs/設計メモ.md の「テナントと管理する人」。運営者(operator グループ)がテナントを作り、
ユーザーをテナントに入れる。運営者はルームの中身を扱わない。

所属を変えると(外すときも)、そのユーザーを元のテナントのルームのメンバーから外し、LiveKit の
ルームからも出す(docs/設計メモ.md の「テナントと管理する人」)。
- 先に所属を変える。これで途中で失敗しても、routing.py の今の所属の確かめがルームを使わせない。
- Connect のルームでは、メンバーの行のテナント(その人がどちら側か)で決める。相手のテナントへ
  移る人も外す(入れ直すのは、移った先の管理者)。
- 最後のオーナーでも外す。オーナーの居ないルームはテナントの管理者が扱う(オーナーを決める、
  アーカイブする。Connect なら残った側のオーナーも扱える)。外せないと所属を変えられなくなる。
- 出せなかったルームのメンバーの行は残して 503 を返す。同じ PUT をやり直すと続きを行う。
"""

from http import HTTPStatus
from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import NotFoundError, ServiceError
from aws_lambda_powertools.event_handler.openapi.params import Body, Path

from voice_intercom_api import room_cleanup, store
from voice_intercom_api.auth import OperatorUser
from voice_intercom_api.models import (
    CreateTenantRequest,
    SetUserTenantRequest,
    Tenant,
    TenantList,
    User,
)
from voice_intercom_api.routing import AUTH, responses

router = Router()


@router.get(
    "/tenants",
    summary="テナントの一覧(運営者)",
    operation_id="listTenants",
    tags=["tenants"],
    security=AUTH,
    responses=responses(TenantList),
)
def list_tenants(_operator: OperatorUser) -> TenantList:
    return TenantList(items=store.list_tenants())


@router.post(
    "/tenants",
    summary="テナントを作る(運営者)",
    operation_id="createTenant",
    tags=["tenants"],
    security=AUTH,
    status_code=201,
    responses=responses(
        Tenant,
        status=201,
        description="作った",
        errors={409: "同じ tenant_id のテナントが既にある"},
    ),
)
def create_tenant(body: Annotated[CreateTenantRequest, Body()], _operator: OperatorUser) -> Tenant:
    try:
        return store.create_tenant(body.tenant_id, body.name)
    except store.AlreadyExistsError as e:
        raise ServiceError(HTTPStatus.CONFLICT, "同じ tenant_id のテナントが既にある") from e


@router.put(
    "/users/<user_id>/tenant",
    summary="ユーザーの所属を変える(運営者)。null なら外す",
    description="元のテナントのルームのメンバーから外し、LiveKit のルームからも出す"
    "(最後のオーナーでも外す。Connect のルームは、その人の側のテナントで決める)。"
    "所属の変更は先に効く。LiveKit から出せなかったルームが残れば 503 で、"
    "同じ PUT をやり直すと続きを行う。",
    operation_id="setUserTenant",
    tags=["tenants"],
    security=AUTH,
    responses=responses(
        User,
        errors={
            404: "テナントか、プロフィールを登録したユーザーがない",
            503: "LiveKit のルームから出しきれなかった。同じ PUT をやり直す",
        },
    ),
)
def set_user_tenant(
    user_id: Annotated[str, Path(min_length=1, max_length=128, description="user_id")],
    body: Annotated[SetUserTenantRequest, Body()],
    _operator: OperatorUser,
) -> User:
    if body.tenant_id is not None and store.get_tenant(body.tenant_id) is None:
        raise NotFoundError("テナントがない")
    try:
        user = store.set_user_tenant(user_id, body.tenant_id)
    except store.NotFoundError as e:
        raise NotFoundError("プロフィールを登録したユーザーがない") from e
    room_ids = store.memberships_outside(user_id, body.tenant_id)
    failed = room_cleanup.evict_from_rooms(room_ids, user_id)
    for room_id in room_ids:
        if room_id not in failed:
            store.delete_member(room_id, user_id)
    if failed:
        raise ServiceError(
            HTTPStatus.SERVICE_UNAVAILABLE, "LiveKit のルームから出しきれなかった。PUT をやり直す"
        )
    return user
