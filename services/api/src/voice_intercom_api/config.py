"""環境変数から読む設定。

名前は infra/envs/<env>/main.tf の module "api" の environment と揃える。
"""

import os
from dataclasses import dataclass
from functools import cache

import boto3


@dataclass(frozen=True)
class Settings:
    # トークンの iss と一致させる(Cognito は https://cognito-idp.<region>.amazonaws.com/<pool id>)
    oidc_issuer: str
    # 模擬 OIDC と Cognito で URL の形が違うので、探索せずに明示する
    oidc_jwks_url: str
    # 受け付ける client_id(アプリ、管理コンソール、Agent)。Cognito のアクセストークンには aud がない
    oidc_client_ids: frozenset[str]
    # アプリが接続する LiveKit の URL(トークンと一緒に返す)
    livekit_client_url: str
    livekit_api_key: str
    livekit_api_secret: str
    # DynamoDB のテーブル名(infra/envs/<env>/main.tf、ローカルは scripts/with-local-aws.sh)
    rooms_table: str
    users_table: str


def _require(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise RuntimeError(f"環境変数 {name} が設定されていない")
    return value


def _livekit_api_secret() -> str:
    # ローカルは値をそのまま受け取る。AWS では SSM のパラメーター名を受け取る
    # (Terraform の state に値を残さないため)
    if secret := os.environ.get("LIVEKIT_API_SECRET"):
        return secret
    name = _require("LIVEKIT_API_SECRET_PARAMETER")
    res = boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)
    return res["Parameter"]["Value"]


@cache
def get_settings() -> Settings:
    """設定を読む。OpenAPI の出力では呼ばれないよう、リクエストの処理中にだけ使う。

    コールドスタートのときに1回だけ読む。SSM の値を変えたら、Lambda を更新して入れ替える。
    """
    return Settings(
        oidc_issuer=_require("OIDC_ISSUER"),
        oidc_jwks_url=_require("OIDC_JWKS_URL"),
        oidc_client_ids=frozenset(
            s.strip() for s in _require("OIDC_CLIENT_IDS").split(",") if s.strip()
        ),
        livekit_client_url=_require("LIVEKIT_CLIENT_URL"),
        livekit_api_key=_require("LIVEKIT_API_KEY"),
        livekit_api_secret=_livekit_api_secret(),
        rooms_table=_require("ROOMS_TABLE"),
        users_table=_require("USERS_TABLE"),
    )
