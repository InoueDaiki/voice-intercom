"""ローカルの開発用サーバー(local_server.py)の、HTTP とイベントの変換。"""

import base64
import json
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from http.server import HTTPServer

import pytest
from conftest import auth_headers

from voice_intercom_api.app import handler
from voice_intercom_api.local_server import (
    LocalLambdaContext,
    _make_handler,  # pyright: ignore[reportPrivateUsage]
    cors_headers,
    from_result,
    to_event,
)

ORIGINS = frozenset({"http://localhost:5173"})


def _event(method: str = "GET", target: str = "/rooms", body: bytes = b"") -> dict:
    return to_event(
        method=method,
        target=target,
        headers=[("Host", "localhost:3000")],
        body=body,
        source_ip="10.0.0.1",
    )


def test_to_event_matches_http_api_v2() -> None:
    now = datetime(2026, 10, 10, 1, 2, 3, tzinfo=UTC)
    event = to_event(
        method="POST",
        target="/rooms?a=1&b=2&a=3",
        headers=[
            ("Host", "localhost:3000"),
            ("Content-Type", "application/json"),
            ("X-Multi", "1"),
            ("x-multi", "2"),
            ("Cookie", "k1=v1; k2=v2"),
        ],
        body=b'{"name":"\xe3\x83\x86"}',
        source_ip="10.0.0.1",
        now=now,
    )

    assert event["version"] == "2.0"
    # ステージは $default なので、パスはそのまま
    assert event["rawPath"] == "/rooms"
    assert event["rawQueryString"] == "a=1&b=2&a=3"
    assert event["queryStringParameters"] == {"a": "1,3", "b": "2"}
    assert event["headers"] == {
        "host": "localhost:3000",
        "content-type": "application/json",
        "x-multi": "1,2",
    }
    assert event["cookies"] == ["k1=v1", "k2=v2"]
    assert event["body"] == '{"name":"テ"}'
    assert event["isBase64Encoded"] is False
    ctx = event["requestContext"]
    assert ctx["http"] == {
        "method": "POST",
        "path": "/rooms",
        "protocol": "HTTP/1.1",
        "sourceIp": "10.0.0.1",
        "userAgent": "",
    }
    assert ctx["stage"] == "$default"
    assert ctx["domainName"] == "localhost:3000"
    assert ctx["timeEpoch"] == int(now.timestamp() * 1000)
    # JWT オーソライザーはないので、authorizer は入れない
    assert "authorizer" not in ctx


def test_route_key_follows_public_routes() -> None:
    assert _event("GET", "/health")["routeKey"] == "GET /health"
    assert _event("GET", "/rooms")["routeKey"] == "$default"
    assert _event("POST", "/health")["routeKey"] == "$default"


def test_to_event_without_body_or_query() -> None:
    event = _event()

    assert "body" not in event
    assert "queryStringParameters" not in event
    assert "cookies" not in event


def test_binary_body_is_base64() -> None:
    event = _event("POST", body=b"\xff\x00")

    assert event["isBase64Encoded"] is True
    assert base64.b64decode(event["body"]) == b"\xff\x00"


def test_from_result() -> None:
    res = from_result(
        {
            "statusCode": 201,
            "headers": {"Content-Type": "application/json"},
            "cookies": ["a=b"],
            "body": '{"ok":true}',
            "isBase64Encoded": False,
        }
    )

    assert res.status == 201
    assert res.headers == [("Content-Type", "application/json"), ("set-cookie", "a=b")]
    assert res.body == b'{"ok":true}'


def test_from_result_base64_and_bare_value() -> None:
    assert from_result({"statusCode": 200, "body": "/w==", "isBase64Encoded": True}).body == b"\xff"
    # statusCode のない戻り値は、API Gateway と同じく 200 の JSON
    bare = from_result({"status": "ok"})
    assert bare.status == 200
    assert json.loads(bare.body) == {"status": "ok"}


def test_cors_preflight_for_allowed_origin() -> None:
    preflight, headers = cors_headers(
        method="OPTIONS",
        headers={"origin": "http://localhost:5173", "access-control-request-method": "GET"},
        allowed_origins=ORIGINS,
    )

    assert preflight is True
    assert dict(headers)["access-control-allow-origin"] == "http://localhost:5173"
    assert "authorization" in dict(headers)["access-control-allow-headers"]


def test_cors_ignores_other_origins() -> None:
    preflight, headers = cors_headers(
        method="OPTIONS",
        headers={"origin": "http://evil.example", "access-control-request-method": "GET"},
        allowed_origins=ORIGINS,
    )

    assert preflight is True
    assert headers == []


def test_cors_simple_request() -> None:
    preflight, headers = cors_headers(
        method="GET", headers={"origin": "http://localhost:5173"}, allowed_origins=ORIGINS
    )

    assert preflight is False
    assert ("access-control-allow-origin", "http://localhost:5173") in headers


# 変換したイベントで、実際の handler が動く


def test_handler_accepts_converted_event() -> None:
    res = from_result(handler(_event("GET", "/health"), LocalLambdaContext()))  # pyright: ignore[reportArgumentType]

    assert res.status == 200
    assert json.loads(res.body) == {"status": "ok"}


@pytest.mark.usefixtures("tables")
def test_handler_reads_authorization_and_body(make_token: Callable[..., str]) -> None:
    headers = [("Content-Type", "application/json")]
    headers += list(auth_headers(make_token()).items())
    put = to_event(
        method="PUT",
        target="/users/me",
        headers=headers,
        body=json.dumps({"display_name": "太郎", "language": "ja"}).encode(),
        source_ip="127.0.0.1",
    )
    res = from_result(handler(put, LocalLambdaContext()))  # pyright: ignore[reportArgumentType]

    assert res.status == 200
    assert json.loads(res.body)["display_name"] == "太郎"


# HTTP サーバーとして


@pytest.fixture
def server() -> Iterator[str]:
    httpd = HTTPServer(("127.0.0.1", 0), _make_handler(ORIGINS))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def test_server_health(server: str) -> None:
    req = urllib.request.Request(f"{server}/health", headers={"Origin": "http://localhost:5173"})
    with urllib.request.urlopen(req) as res:
        assert res.status == 200
        assert res.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert json.loads(res.read()) == {"status": "ok"}


def test_server_preflight_does_not_call_handler(server: str) -> None:
    # /rooms は本来トークンが要るが、プリフライトは API Gateway と同じく Lambda に渡さない
    req = urllib.request.Request(
        f"{server}/rooms",
        method="OPTIONS",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    with urllib.request.urlopen(req) as res:
        assert res.status == 204
        assert res.headers["access-control-allow-methods"] == "GET,POST,PUT,PATCH,DELETE"


def test_server_returns_handler_status(server: str) -> None:
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(f"{server}/rooms")

    assert e.value.code == 401
