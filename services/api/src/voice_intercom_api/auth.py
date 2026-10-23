"""OIDC のアクセストークン(JWT)の検証。

API Gateway の JWT オーソライザーに任せきりにせず、Lambda の中でも検証する。
Cognito のアクセストークンと、それに claims を寄せた模擬 OIDC のトークンの両方を受け付ける。
トークンには、利用者(アプリ・管理コンソール)のものと、Agent の client credentials のものがある。
"""

from collections.abc import Callable
from dataclasses import dataclass
from functools import cache
from typing import Annotated

import jwt
from aws_lambda_powertools.event_handler import Depends
from aws_lambda_powertools.event_handler.exceptions import ForbiddenError, UnauthorizedError
from aws_lambda_powertools.event_handler.request import Request

from voice_intercom_api.config import get_settings

# Cognito も模擬 OIDC も RS256 で署名する
_ALGORITHMS = ["RS256"]

# Agent が client credentials で取るトークンのスコープ(infra/modules/cognito の resource server)
AGENT_SCOPE = "voice-intercom/agent"

# テナントの管理者の Cognito のグループ(管理コンソールに入れる人。自分のテナントだけを管理する)
ADMIN_GROUP = "admin"
# 運営者の Cognito のグループ(テナントを作り、ユーザーをテナントに入れる。ルームの中身は扱わない)
OPERATOR_GROUP = "operator"

# トークンの kid から検証用の公開鍵を返す関数
KeyResolver = Callable[[str], jwt.PyJWK | str | bytes]


@dataclass(frozen=True)
class Principal:
    """検証済みのアクセストークンの持ち主。"""

    # 利用者は Cognito の sub(users テーブルの user_id)、Agent は client_id
    sub: str
    client_id: str
    groups: tuple[str, ...]
    scopes: frozenset[str]

    @property
    def is_agent(self) -> bool:
        return AGENT_SCOPE in self.scopes

    @property
    def is_admin(self) -> bool:
        return ADMIN_GROUP in self.groups

    @property
    def is_operator(self) -> bool:
        return OPERATOR_GROUP in self.groups


class TokenVerifier:
    def __init__(
        self, *, issuer: str, client_ids: frozenset[str], resolve_key: KeyResolver
    ) -> None:
        self._issuer = issuer
        self._client_ids = client_ids
        self._resolve_key = resolve_key

    def verify(self, token: str) -> Principal:
        """署名・期限・発行者・用途・client_id を確かめる。失敗したら UnauthorizedError。"""
        try:
            key = self._resolve_key(token)
            claims = jwt.decode(
                token,
                key,
                algorithms=_ALGORITHMS,
                issuer=self._issuer,
                # Cognito のアクセストークンには aud がないので、client_id で確かめる
                options={"verify_aud": False, "require": ["exp", "iat", "iss", "sub"]},
            )
        except jwt.PyJWTError as e:
            raise UnauthorizedError("トークンが不正") from e

        if claims.get("token_use") != "access":
            raise UnauthorizedError("アクセストークンではない")
        if claims.get("client_id") not in self._client_ids:
            raise UnauthorizedError("許可されていない client_id")

        groups = claims.get("cognito:groups", [])
        return Principal(
            sub=claims["sub"],
            client_id=claims["client_id"],
            groups=tuple(groups) if isinstance(groups, list) else (),
            scopes=frozenset(str(claims.get("scope", "")).split()),
        )


@cache
def get_verifier() -> TokenVerifier:
    settings = get_settings()
    # 鍵はウォームスタートの間キャッシュされる
    jwks = jwt.PyJWKClient(settings.oidc_jwks_url)
    return TokenVerifier(
        issuer=settings.oidc_issuer,
        client_ids=settings.oidc_client_ids,
        resolve_key=lambda token: jwks.get_signing_key_from_jwt(token),
    )


def current_principal(request: Request) -> Principal:
    """Authorization ヘッダーのトークンを検証する。"""
    # resolved_event の headers は大文字小文字を区別しない
    header = request.resolved_event.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise UnauthorizedError("Authorization ヘッダーがない")
    return get_verifier().verify(token)


def current_user(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
    """利用者のトークンだけを通す。Agent のトークンは 403。"""
    if principal.is_agent:
        raise ForbiddenError("利用者のトークンが要る")
    return principal


def admin_user(user: Annotated[Principal, Depends(current_user)]) -> Principal:
    """管理者(admin グループ)だけを通す。"""
    if not user.is_admin:
        raise ForbiddenError("管理者の権限が要る")
    return user


def operator_user(user: Annotated[Principal, Depends(current_user)]) -> Principal:
    """運営者(operator グループ)だけを通す。"""
    if not user.is_operator:
        raise ForbiddenError("運営者の権限が要る")
    return user


def agent_principal(principal: Annotated[Principal, Depends(current_principal)]) -> Principal:
    """Agent(client credentials)のトークンだけを通す。利用者のトークンは 403。"""
    if not principal.is_agent:
        raise ForbiddenError("Agent のトークンが要る")
    return principal


# ルートの引数に付けて使う
CurrentUser = Annotated[Principal, Depends(current_user)]
AdminUser = Annotated[Principal, Depends(admin_user)]
OperatorUser = Annotated[Principal, Depends(operator_user)]
AgentPrincipal = Annotated[Principal, Depends(agent_principal)]
