import json
import time
from collections.abc import Callable, Iterator
from typing import Any

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from moto import mock_aws

from voice_intercom_api import auth, config, store

ISSUER = "http://oidc.test/default"
CLIENT_ID = "mobile"
LIVEKIT_API_KEY = "devkey"
LIVEKIT_API_SECRET = "secret-secret-secret-secret-secret"
ROOMS_TABLE = "voice-intercom-test-rooms"
ROOM_MEMBERS_TABLE = "voice-intercom-test-room-members"
USERS_TABLE = "voice-intercom-test-users"
TENANTS_TABLE = "voice-intercom-test-tenants"


@pytest.fixture(scope="session")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def make_token(signing_key: rsa.RSAPrivateKey) -> Callable[..., str]:
    """Cognito のアクセストークンと同じ形の JWT を作る。キーワード引数で claims を上書きする。"""

    def make(**overrides: Any) -> str:
        now = int(time.time())
        claims = {
            "iss": ISSUER,
            "sub": "user-1",
            "username": "taro",
            "client_id": CLIENT_ID,
            "token_use": "access",
            "cognito:groups": ["admin"],
            "iat": now,
            "exp": now + 300,
        } | overrides
        return jwt.encode(
            {k: v for k, v in claims.items() if v is not None}, signing_key, algorithm="RS256"
        )

    return make


@pytest.fixture
def verifier(signing_key: rsa.RSAPrivateKey) -> auth.TokenVerifier:
    public_key = signing_key.public_key()
    return auth.TokenVerifier(
        issuer=ISSUER,
        client_ids=frozenset({CLIENT_ID}),
        resolve_key=lambda _token: public_key,  # pyright: ignore[reportArgumentType]
    )


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch, verifier: auth.TokenVerifier) -> Iterator[None]:
    """Lambda の環境変数を設定し、JWKS の取得を差し替える。"""
    for name, value in {
        "OIDC_ISSUER": ISSUER,
        "OIDC_JWKS_URL": "http://oidc.test/default/jwks",
        "OIDC_CLIENT_IDS": CLIENT_ID,
        "LIVEKIT_CLIENT_URL": "ws://livekit.test:7880",
        "LIVEKIT_API_KEY": LIVEKIT_API_KEY,
        "LIVEKIT_API_SECRET": LIVEKIT_API_SECRET,
        "ROOMS_TABLE": ROOMS_TABLE,
        "ROOM_MEMBERS_TABLE": ROOM_MEMBERS_TABLE,
        "USERS_TABLE": USERS_TABLE,
        "TENANTS_TABLE": TENANTS_TABLE,
    }.items():
        monkeypatch.setenv(name, value)
    config.get_settings.cache_clear()
    monkeypatch.setattr(auth, "get_verifier", lambda: verifier)
    yield
    config.get_settings.cache_clear()


@pytest.fixture
def tables(monkeypatch: pytest.MonkeyPatch, env: None) -> Iterator[None]:
    """moto で DynamoDB を模擬し、rooms、room_members、users、tenants のテーブルを作る。

    キーは dev 環境と揃える。
    """
    # 本物の AWS に向かないよう、ダミーの鍵を使う
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL_DYNAMODB", raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-northeast-1")
    monkeypatch.setenv("AWS_REGION", "ap-northeast-1")
    with mock_aws():
        dynamodb = boto3.client("dynamodb")

        def gsi(name: str, hash_key: str, range_key: str | None = None) -> dict[str, Any]:
            keys = [{"AttributeName": hash_key, "KeyType": "HASH"}]
            if range_key:
                keys.append({"AttributeName": range_key, "KeyType": "RANGE"})
            projection = "KEYS_ONLY" if range_key else "ALL"
            return {
                "IndexName": name,
                "KeySchema": keys,
                "Projection": {"ProjectionType": projection},
            }

        def create(
            name: str, key: str, range_key: str | None = None, gsis: tuple[dict[str, Any], ...] = ()
        ) -> None:
            attrs = {key, range_key, *(k["AttributeName"] for g in gsis for k in g["KeySchema"])}
            keys = [{"AttributeName": key, "KeyType": "HASH"}]
            if range_key:
                keys.append({"AttributeName": range_key, "KeyType": "RANGE"})
            dynamodb.create_table(
                TableName=name,
                BillingMode="PAY_PER_REQUEST",
                AttributeDefinitions=[
                    {"AttributeName": a, "AttributeType": "S"} for a in sorted(attrs - {None})
                ],
                KeySchema=keys,
                **({"GlobalSecondaryIndexes": list(gsis)} if gsis else {}),
            )

        create(
            ROOMS_TABLE,
            "room_id",
            gsis=(
                gsi(store.TENANT_ROOMS_INDEX, "tenant_id"),
                gsi(store.CONNECT_ROOMS_INDEX, "connect_tenant_id"),
            ),
        )
        create(USERS_TABLE, "user_id", gsis=(gsi(store.TENANT_USERS_INDEX, "tenant_id"),))
        create(TENANTS_TABLE, "tenant_id")
        create(
            ROOM_MEMBERS_TABLE,
            "room_id",
            "user_id",
            gsis=(gsi(store.MEMBER_ROOMS_INDEX, "user_id", "room_id"),),
        )
        store._table.cache_clear()  # pyright: ignore[reportPrivateUsage]
        yield
        store._table.cache_clear()  # pyright: ignore[reportPrivateUsage]


def auth_headers(token: str | None) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"} if token else {}


def http_event(
    method: str, path: str, *, body: Any = None, headers: dict[str, str] | None = None
) -> dict[str, Any]:
    """API Gateway HTTP API(ペイロード 2.0)のイベントを作る。"""
    return {
        "version": "2.0",
        "routeKey": f"{method} {path}",
        "rawPath": path,
        "rawQueryString": "",
        "headers": {"content-type": "application/json"} | (headers or {}),
        "requestContext": {
            "http": {
                "method": method,
                "path": path,
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
            },
            "stage": "$default",
        },
        "body": None if body is None else json.dumps(body),
        "isBase64Encoded": False,
    }
