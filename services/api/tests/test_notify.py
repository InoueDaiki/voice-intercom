import json
import threading
import time
import urllib.parse
from collections.abc import Callable, Iterator, Mapping
from typing import Any

import boto3
import jwt
import pytest
from botocore.exceptions import ClientError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from voice_intercom_api import device_store, notify
from voice_intercom_api.device_store import Device

pytestmark = pytest.mark.usefixtures("tables")

PARAMETER = "/voice-intercom-test/fcm/service-account"
TOKEN_URI = "https://oauth2.test/token"
SEND_URL = "https://fcm.googleapis.com/v1/projects/proj-1/messages:send"


@pytest.fixture(scope="module")
def sa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def service_account_json(sa_key: rsa.RSAPrivateKey) -> str:
    pem = sa_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    return json.dumps(
        {
            "type": "service_account",
            "project_id": "proj-1",
            "private_key_id": "kid-1",
            "private_key": pem,
            "client_email": "fcm@proj-1.iam.gserviceaccount.com",
            "token_uri": TOKEN_URI,
        }
    )


@pytest.fixture(autouse=True)
def reset(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv("FCM_SERVICE_ACCOUNT", raising=False)
    monkeypatch.delenv("FCM_SERVICE_ACCOUNT_PARAMETER", raising=False)
    notify.service_account.cache_clear()
    notify._access_token.clear()  # pyright: ignore[reportPrivateUsage]
    yield
    notify.service_account.cache_clear()
    notify._access_token.clear()  # pyright: ignore[reportPrivateUsage]


@pytest.fixture
def ssm_configured(monkeypatch: pytest.MonkeyPatch, service_account_json: str) -> None:
    boto3.client("ssm").put_parameter(
        Name=PARAMETER, Type="SecureString", Value=service_account_json
    )
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT_PARAMETER", PARAMETER)


Responder = Callable[[Mapping[str, Any]], tuple[int, dict[str, Any]]]


class FakeGoogle:
    """トークンエンドポイントと FCM の代わり。送られたものを記録する。"""

    def __init__(self) -> None:
        self.token_requests: list[dict[str, str]] = []
        self.messages: list[dict[str, Any]] = []
        self.auth_headers: list[str] = []
        # トークンごとの FCM の応答。なければ 200
        self.responses: dict[str, tuple[int, dict[str, Any]] | list] = {}
        self.expires_in = 3600

    def post(
        self, url: str, *, data: bytes, headers: Mapping[str, str]
    ) -> tuple[int, dict[str, Any]]:
        if url == TOKEN_URI:
            form = dict(urllib.parse.parse_qsl(data.decode()))
            self.token_requests.append(form)
            n = len(self.token_requests)
            return 200, {"access_token": f"access-{n}", "expires_in": self.expires_in}
        assert url == SEND_URL
        self.auth_headers.append(headers["authorization"])
        message = json.loads(data)["message"]
        self.messages.append(message)
        res = self.responses.get(message["token"], (200, {"name": "projects/proj-1/messages/1"}))
        # リストなら、呼ばれるたびに先頭から返す
        return res.pop(0) if isinstance(res, list) else res


@pytest.fixture
def google(monkeypatch: pytest.MonkeyPatch) -> FakeGoogle:
    fake = FakeGoogle()
    monkeypatch.setattr(notify, "_post", fake.post)
    return fake


def fcm_error(status: int, code: str, error_code: str | None, **extra: Any) -> tuple[int, dict]:
    details: list[dict[str, Any]] = []
    if error_code:
        details.append(
            {
                "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                "errorCode": error_code,
            }
        )
    details += extra.pop("details", [])
    error = {
        "code": status,
        "message": extra.pop("message", ""),
        "status": code,
        "details": details,
    }
    return status, {"error": error}


def test_sends_per_platform(ssm_configured: None, google: FakeGoogle) -> None:
    device_store.register("user-1", "token-ios", "ios")
    device_store.register("user-2", "token-android", "android")

    result = notify.send_to_users(
        ["user-1", "user-2", "nobody"], title="ルーム A", body="こんにちは", data={"room_id": "a"}
    )

    assert result == notify.SendResult(sent=2)
    ios, android = google.messages
    assert ios == {
        "token": "token-ios",
        "notification": {"title": "ルーム A", "body": "こんにちは"},
        "data": {"room_id": "a"},
        "apns": {
            "headers": {"apns-push-type": "alert", "apns-priority": "10"},
            "payload": {"aps": {"sound": "default"}},
        },
    }
    assert android["token"] == "token-android"
    assert android["android"] == {"priority": "HIGH"}
    assert "apns" not in android
    assert google.auth_headers == ["Bearer access-1", "Bearer access-1"]


def test_access_token_assertion(
    ssm_configured: None, google: FakeGoogle, sa_key: rsa.RSAPrivateKey
) -> None:
    assert notify.access_token() == "access-1"

    (form,) = google.token_requests
    assert form["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
    assertion = form["assertion"]
    assert jwt.get_unverified_header(assertion)["kid"] == "kid-1"
    claims = jwt.decode(assertion, sa_key.public_key(), algorithms=["RS256"], audience=TOKEN_URI)
    assert claims["iss"] == "fcm@proj-1.iam.gserviceaccount.com"
    assert claims["scope"] == "https://www.googleapis.com/auth/firebase.messaging"
    assert claims["exp"] - claims["iat"] == 3600


def test_access_token_is_cached(
    ssm_configured: None, google: FakeGoogle, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = [1_000_000.0]
    monkeypatch.setattr(notify.time, "time", lambda: now[0])

    assert notify.access_token() == "access-1"
    now[0] += 3600 - 301
    assert notify.access_token() == "access-1"
    assert len(google.token_requests) == 1

    # 期限の5分前を過ぎたら作り直す
    now[0] += 2
    assert notify.access_token() == "access-2"


def test_service_account_read_once(
    ssm_configured: None, google: FakeGoogle, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = []
    real_client = boto3.client

    def client(service: str) -> Any:
        calls.append(service)
        return real_client(service)  # pyright: ignore[reportCallIssue, reportArgumentType]

    monkeypatch.setattr(notify.boto3, "client", client)
    device_store.register("user-1", "token-1", "ios")

    notify.send_to_users(["user-1"], title="t", body="b")
    notify.send_to_users(["user-1"], title="t", body="b")

    assert calls == ["ssm"]
    assert len(google.token_requests) == 1


def test_service_account_from_env(
    monkeypatch: pytest.MonkeyPatch, service_account_json: str, google: FakeGoogle
) -> None:
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT", service_account_json)
    device_store.register("user-1", "token-1", "android")

    assert notify.send_to_users(["user-1"], title="t", body="b").sent == 1


def test_not_configured_sends_nothing(google: FakeGoogle) -> None:
    device_store.register("user-1", "token-1", "android")

    assert notify.send_to_users(["user-1"], title="t", body="b") == notify.SendResult()
    assert google.messages == []


def test_missing_parameter_is_error_until_it_is_put(
    monkeypatch: pytest.MonkeyPatch, service_account_json: str, google: FakeGoogle
) -> None:
    # パラメーターは Terraform で作らないので、手で入れるまでは無い
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT_PARAMETER", PARAMETER)
    device_store.register("user-1", "token-1", "android")

    with pytest.raises(ClientError) as e:
        notify.send_to_users(["user-1"], title="t", body="b")
    assert e.value.response["Error"]["Code"] == "ParameterNotFound"

    # 失敗は cache に残らないので、入れれば実行環境を入れ替えなくても送れる
    boto3.client("ssm").put_parameter(
        Name=PARAMETER, Type="SecureString", Value=service_account_json
    )
    assert notify.send_to_users(["user-1"], title="t", body="b").sent == 1


def test_broken_parameter_is_error(monkeypatch: pytest.MonkeyPatch) -> None:
    boto3.client("ssm").put_parameter(Name=PARAMETER, Type="SecureString", Value="not json")
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT_PARAMETER", PARAMETER)
    device_store.register("user-1", "token-1", "android")

    with pytest.raises(RuntimeError, match="サービスアカウント"):
        notify.send_to_users(["user-1"], title="t", body="b")


def test_removes_invalid_tokens(ssm_configured: None, google: FakeGoogle) -> None:
    for token in ["ok", "unregistered", "bad-token", "bad-payload", "unavailable"]:
        device_store.register("user-1", token, "android")
    device_store.register("user-2", "unregistered-2", "ios")
    google.responses = {
        "unregistered": fcm_error(404, "NOT_FOUND", "UNREGISTERED"),
        "unregistered-2": fcm_error(404, "NOT_FOUND", "UNREGISTERED"),
        "bad-token": fcm_error(
            400,
            "INVALID_ARGUMENT",
            "INVALID_ARGUMENT",
            message="The registration token is not a valid FCM registration token",
            details=[
                {
                    "@type": "type.googleapis.com/google.rpc.BadRequest",
                    "fieldViolations": [{"field": "message.token"}],
                }
            ],
        ),
        # 本文の不備による INVALID_ARGUMENT では消さない
        "bad-payload": fcm_error(
            400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", message="Invalid JSON payload received."
        ),
        "unavailable": fcm_error(503, "UNAVAILABLE", "UNAVAILABLE"),
    }

    result = notify.send_to_users(["user-1", "user-2"], title="t", body="b")

    assert result == notify.SendResult(sent=1, failed=2, removed=3)
    assert [d.token for d in device_store.list_devices(["user-1", "user-2"])] == [
        "ok",
        "bad-payload",
        "unavailable",
    ]


def test_retries_once_on_401(ssm_configured: None, google: FakeGoogle) -> None:
    device_store.register("user-1", "token-1", "android")
    google.responses = {"token-1": [fcm_error(401, "UNAUTHENTICATED", None), (200, {})]}

    assert notify.send_to_users(["user-1"], title="t", body="b") == notify.SendResult(sent=1)
    assert google.auth_headers == ["Bearer access-1", "Bearer access-2"]


def test_network_error_counts_as_failed(
    ssm_configured: None, google: FakeGoogle, monkeypatch: pytest.MonkeyPatch
) -> None:
    device_store.register("user-1", "token-1", "android")
    notify.access_token()

    def fail(url: str, **_kwargs: Any) -> tuple[int, dict]:
        raise TimeoutError("timed out")

    monkeypatch.setattr(notify, "_post", fail)

    assert notify.send_to_users(["user-1"], title="t", body="b") == notify.SendResult(failed=1)
    assert [d.token for d in device_store.list_devices(["user-1"])] == ["token-1"]


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        pytest.param(404, fcm_error(404, "NOT_FOUND", "UNREGISTERED")[1], True, id="unregistered"),
        pytest.param(
            400,
            fcm_error(400, "INVALID_ARGUMENT", None, message="Invalid registration token")[1],
            True,
            id="invalid-token-message",
        ),
        pytest.param(
            400,
            fcm_error(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", message="data too big")[1],
            False,
            id="invalid-payload",
        ),
        pytest.param(403, fcm_error(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH")[1], False),
        pytest.param(500, {}, False, id="no-body"),
    ],
)
def test_is_invalid_token(status: int, body: dict, expected: bool) -> None:
    assert notify.is_invalid_token(status, body) is expected


def test_build_message_stringifies_data() -> None:
    message = notify.build_message(
        Device("u", "t", "android"),
        title="t",
        body="b",
        data={"n": 1},  # pyright: ignore[reportArgumentType]
    )
    assert message["message"]["data"] == {"n": "1"}


# send_to_users_within


def test_within_returns_all_when_finished(ssm_configured: None, google: FakeGoogle) -> None:
    device_store.register("user-1", "token-1", "android")
    google.responses = {"token-1": (500, {})}

    # FCM が失敗した人、端末を登録していない人も「送り終えた」に入る
    done = notify.send_to_users_within(
        ["user-1", "user-2"], title="t", body="b", data={}, timeout_s=5, label="テスト"
    )
    assert done == {"user-1", "user-2"}


def test_within_error_returns_done_so_far(
    ssm_configured: None, google: FakeGoogle, monkeypatch: pytest.MonkeyPatch
) -> None:
    device_store.register("user-1", "token-1", "android")

    def fail() -> str:
        raise RuntimeError("FCM のアクセストークンを作れなかった")

    monkeypatch.setattr(notify, "access_token", fail)

    # 端末を登録していない user-2 だけが送り終えている
    done = notify.send_to_users_within(
        ["user-1", "user-2"], title="t", body="b", data={}, timeout_s=5, label="テスト"
    )
    assert done == {"user-2"}
    assert google.messages == []


def test_within_cancels_rest_on_timeout(
    ssm_configured: None, google: FakeGoogle, monkeypatch: pytest.MonkeyPatch
) -> None:
    for i in (1, 2, 3):
        device_store.register(f"user-{i}", f"token-{i}", "android")
    notify.access_token()
    # 1台ずつ順に送る(user_id の順)
    monkeypatch.setattr(notify, "_MAX_WORKERS", 1)
    release = threading.Event()
    post = google.post

    def slow(url: str, *, data: bytes, headers: Mapping[str, str]) -> tuple[int, dict[str, Any]]:
        res = post(url, data=data, headers=headers)
        if json.loads(data)["message"]["token"] == "token-2":
            release.wait(5)
        return res

    monkeypatch.setattr(notify, "_post", slow)
    try:
        done = notify.send_to_users_within(
            ["user-1", "user-2", "user-3"], title="t", body="b", data={}, timeout_s=0.5, label="t"
        )
    finally:
        release.set()

    # user-2 は送っている途中だったので数えない。user-3 にはもう送らない
    assert done == {"user-1"}
    time.sleep(0.2)
    assert [m["token"] for m in google.messages] == ["token-1", "token-2"]


def test_cancelled_progress_skips_token_fetch(ssm_configured: None, google: FakeGoogle) -> None:
    device_store.register("user-1", "token-1", "android")
    progress = notify.SendProgress()
    progress.cancel()

    result = notify.send_to_users(["user-1"], title="t", body="b", progress=progress)

    assert result == notify.SendResult(failed=1)
    assert google.token_requests == []
    assert google.messages == []
    assert progress.done() == set()
