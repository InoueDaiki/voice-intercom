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
    # トークンでディスパッチする Agent の名前(services/agent の AGENT_NAME と揃える)
    agent_name: str
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
        agent_name=os.environ.get("AGENT_NAME", "voice-intercom"),
        rooms_table=_require("ROOMS_TABLE"),
        users_table=_require("USERS_TABLE"),
    )


@dataclass(frozen=True)
class TimelineSettings:
    """履歴とメディアの API(timeline.py、media.py)が使う設定。

    ルームとユーザーの API だけを動かすときに、要らない環境変数を求めないよう、
    Settings と分けてある。
    """

    # DynamoDB の timeline テーブル(アップロード中のメディアの仮の行も置く。timeline_store.py)
    timeline_table: str
    # 画像・動画を置く S3 のバケット
    media_bucket: str
    # 表示・再生の URL の元(本番は CloudFront、ローカルは SeaweedFS のバケットの URL)。
    # 末尾の / は除く
    media_base_url: str


@cache
def get_timeline_settings() -> TimelineSettings:
    """get_settings と同じく、コールドスタートのときに1回だけ読む。"""
    return TimelineSettings(
        timeline_table=_require("TIMELINE_TABLE"),
        media_bucket=_require("MEDIA_BUCKET"),
        media_base_url=_require("MEDIA_BASE_URL").rstrip("/"),
    )
