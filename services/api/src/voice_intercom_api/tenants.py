"""テナントの API(運営者)。

docs/設計メモ.md の「テナントと管理する人」。運営者(operator グループ)がテナントを作り、
ユーザーをテナントに入れる。運営者はルームの中身を扱わない。
"""

from http import HTTPStatus
from typing import Annotated

from aws_lambda_powertools.event_handler.api_gateway import Router
from aws_lambda_powertools.event_handler.exceptions import NotFoundError, ServiceError
from aws_lambda_powertools.event_handler.openapi.params import Body, Path

from voice_intercom_api import store
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
    description="入っているルームのメンバーからは外さない。",
    operation_id="setUserTenant",
    tags=["tenants"],
    security=AUTH,
    responses=responses(User, errors={404: "テナントか、プロフィールを登録したユーザーがない"}),
)
def set_user_tenant(
    user_id: Annotated[str, Path(min_length=1, max_length=128, description="user_id")],
    body: Annotated[SetUserTenantRequest, Body()],
    _operator: OperatorUser,
) -> User:
    if body.tenant_id is not None and store.get_tenant(body.tenant_id) is None:
        raise NotFoundError("テナントがない")
    try:
        return store.set_user_tenant(user_id, body.tenant_id)
    except store.NotFoundError as e:
        raise NotFoundError("プロフィールを登録したユーザーがない") from e
