"""REST API をローカルで動かす開発用の HTTP サーバー(`mise run api`)。

HTTP のリクエストを API Gateway HTTP API(ペイロード 2.0)のイベントに変換して `app.handler` を呼び、
その応答を HTTP で返す。Lambda には載せない(scripts/build-api.sh で外す)。標準ライブラリだけで書く。

本番(infra/modules/api)との違い:
- JWT オーソライザーはない。トークンは Lambda の中の検証(auth.py)だけで確かめる。
  Lambda は `requestContext.authorizer` を使わないので、イベントにも入れない。
- ステージは `$default` なので、パスに前置きはない。Vite は `/api` を外してから中継してくる。
- CORS は API Gateway の cors_configuration と同じ設定で、このサーバーが返す。
- リクエストは1つずつ処理する(Lambda の1つの実行環境と同じ)。

    uv run python -m voice_intercom_api.local_server [--host 0.0.0.0] [--port 3000] [--no-reload]
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import traceback
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlsplit

# infra/envs/<env>/main.tf の public_routes と揃える。これ以外の routeKey は `$default`
PUBLIC_ROUTES = frozenset({"GET /health"})

# infra/modules/api の cors_configuration と揃える
CORS_ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE"
CORS_ALLOW_HEADERS = "authorization,content-type"
CORS_MAX_AGE = "3600"
# 許可するオリジン(カンマ区切り)。本番の dev 環境と同じく、管理コンソールの開発サーバー
DEFAULT_CORS_ORIGINS = "http://localhost:5173"

# 読み直しのために見張るディレクトリ(このパッケージ)
_PACKAGE_DIR = Path(__file__).resolve().parent


def to_event(
    *,
    method: str,
    target: str,
    headers: Iterable[tuple[str, str]],
    body: bytes,
    source_ip: str,
    protocol: str = "HTTP/1.1",
    now: datetime | None = None,
) -> dict[str, Any]:
    """HTTP のリクエストを API Gateway HTTP API(ペイロード 2.0)のイベントにする。

    target はリクエスト行のパス(クエリつき)。API Gateway と同じく、次のようにまとめる。
    - ヘッダー名は小文字にし、同じ名前の値はカンマでつなぐ。Cookie は `cookies` に分ける。
    - 同じ名前のクエリはカンマでつなぐ。
    - 本文は UTF-8 として読めればそのまま、読めなければ Base64 にする。
    """
    now = now or datetime.now(UTC)
    url = urlsplit(target)
    path = url.path or "/"

    merged: dict[str, str] = {}
    cookies: list[str] = []
    for name, value in headers:
        key = name.lower()
        if key == "cookie":
            cookies.extend(c.strip() for c in value.split(";") if c.strip())
            continue
        merged[key] = f"{merged[key]},{value}" if key in merged else value

    query: dict[str, str] = {}
    for name, value in parse_qsl(url.query, keep_blank_values=True):
        query[name] = f"{query[name]},{value}" if name in query else value

    route_key = f"{method} {path}"
    event: dict[str, Any] = {
        "version": "2.0",
        "routeKey": route_key if route_key in PUBLIC_ROUTES else "$default",
        "rawPath": path,
        "rawQueryString": url.query,
        "headers": merged,
        "requestContext": {
            "accountId": "000000000000",
            "apiId": "local",
            "domainName": merged.get("host", "localhost"),
            "domainPrefix": merged.get("host", "localhost").split(".")[0],
            "http": {
                "method": method,
                "path": path,
                "protocol": protocol,
                "sourceIp": source_ip,
                "userAgent": merged.get("user-agent", ""),
            },
            "requestId": str(uuid.uuid4()),
            "routeKey": route_key if route_key in PUBLIC_ROUTES else "$default",
            "stage": "$default",
            "time": now.strftime("%d/%b/%Y:%H:%M:%S +0000"),
            "timeEpoch": int(now.timestamp() * 1000),
        },
        "isBase64Encoded": False,
    }
    if cookies:
        event["cookies"] = cookies
    if query:
        event["queryStringParameters"] = query
    if body:
        try:
            event["body"] = body.decode("utf-8")
        except UnicodeDecodeError:
            event["body"] = base64.b64encode(body).decode("ascii")
            event["isBase64Encoded"] = True
    return event


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: list[tuple[str, str]] = field(default_factory=list)
    body: bytes = b""


def from_result(result: Any) -> HttpResponse:
    """Lambda の戻り値(ペイロード 2.0)を HTTP の応答にする。

    statusCode のない戻り値は、API Gateway と同じく 200 の JSON として扱う。
    """
    if not isinstance(result, dict) or "statusCode" not in result:
        return HttpResponse(
            status=200,
            headers=[("content-type", "application/json")],
            body=json.dumps(result).encode(),
        )
    headers = [(str(k), str(v)) for k, v in (result.get("headers") or {}).items()]
    headers += [("set-cookie", str(c)) for c in result.get("cookies") or []]
    raw = result.get("body") or ""
    body = base64.b64decode(raw) if result.get("isBase64Encoded") else str(raw).encode()
    return HttpResponse(status=int(result["statusCode"]), headers=headers, body=body)


def cors_headers(
    *, method: str, headers: Mapping[str, str], allowed_origins: frozenset[str]
) -> tuple[bool, list[tuple[str, str]]]:
    """API Gateway の CORS の扱いをまねる。(プリフライトか, 付けるヘッダー)を返す。

    ヘッダーの名前は小文字で渡す。許可していないオリジンには何も付けない(ブラウザが止める)。
    """
    origin = headers.get("origin")
    preflight = method == "OPTIONS" and "access-control-request-method" in headers
    if not origin or origin not in allowed_origins:
        return preflight, []
    out = [("access-control-allow-origin", origin), ("vary", "origin")]
    if preflight:
        out += [
            ("access-control-allow-methods", CORS_ALLOW_METHODS),
            ("access-control-allow-headers", CORS_ALLOW_HEADERS),
            ("access-control-max-age", CORS_MAX_AGE),
        ]
    return preflight, out


@dataclass
class LocalLambdaContext:
    """`LambdaContext` の代わり。Powertools が参照する属性だけを持つ。"""

    function_name: str = "voice-intercom-local-api"
    function_version: str = "$LATEST"
    invoked_function_arn: str = (
        "arn:aws:lambda:ap-northeast-1:000000000000:function:voice-intercom-local-api"
    )
    memory_limit_in_mb: int = 512
    aws_request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    log_group_name: str = "/aws/lambda/voice-intercom-local-api"
    log_stream_name: str = "local"

    def get_remaining_time_in_millis(self) -> int:
        return 30_000


def _make_handler(allowed_origins: frozenset[str]) -> type[BaseHTTPRequestHandler]:
    # 設定がなくても /health は応答するので、ここで初めて読み込む
    from voice_intercom_api.app import handler as lambda_handler

    class Handler(BaseHTTPRequestHandler):
        server_version = "voice-intercom-local-api"

        def _handle(self) -> None:
            started = time.monotonic()
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(length) if length else b""
            lower = {k.lower(): v for k, v in self.headers.items()}
            preflight, cors = cors_headers(
                method=self.command, headers=lower, allowed_origins=allowed_origins
            )

            if preflight:
                # API Gateway はプリフライトを Lambda に渡さずに返す
                res = HttpResponse(status=HTTPStatus.NO_CONTENT)
            else:
                event = to_event(
                    method=self.command,
                    target=self.path,
                    headers=self.headers.items(),
                    body=body,
                    source_ip=self.client_address[0],
                    protocol=self.request_version,
                )
                try:
                    res = from_result(lambda_handler(event, LocalLambdaContext()))  # pyright: ignore[reportArgumentType]
                except Exception:
                    # Lambda が落ちたときの API Gateway の応答に合わせる
                    traceback.print_exc()
                    res = HttpResponse(
                        status=500,
                        headers=[("content-type", "application/json")],
                        body=b'{"message":"Internal Server Error"}',
                    )

            self.send_response(res.status)
            for name, value in [*res.headers, *cors]:
                if name.lower() in {"content-length", "connection"}:
                    continue
                self.send_header(name, value)
            self.send_header("content-length", str(len(res.body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(res.body)
            self.log_message(
                '"%s %s" %d %.0fms',
                self.command,
                self.path,
                res.status,
                (time.monotonic() - started) * 1000,
            )

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_HEAD = _handle

        def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
            # 所要時間つきで _handle が出すので、既定の1行は出さない
            pass

    return Handler


def serve(host: str, port: int, allowed_origins: frozenset[str]) -> None:
    from voice_intercom_api.config import get_settings

    try:
        get_settings()
    except Exception as e:
        # /health は設定なしでも動くので止めずに知らせる。それ以外のルートは 500 になる
        print(f"警告: {e}(scripts/with-local-aws.sh と .env を確かめる)", file=sys.stderr)

    # リクエストは1つずつ処理する(Lambda の1つの実行環境と同じく、同時には呼ばない)
    httpd = HTTPServer((host, port), _make_handler(allowed_origins))
    print(f"API: http://{host}:{port}(CORS: {', '.join(sorted(allowed_origins))})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def _snapshot() -> dict[Path, float]:
    return {p: p.stat().st_mtime for p in _PACKAGE_DIR.rglob("*.py")}


def run_with_reload(child_args: list[str]) -> None:
    """パッケージの .py が変わったら、サーバーの子プロセスを起動し直す。

    設定(get_settings)や JWKS もキャッシュしているので、モジュールを読み直すのではなく、
    プロセスごと入れ替える。
    """
    cmd = [sys.executable, "-m", "voice_intercom_api.local_server", "--no-reload", *child_args]
    child = subprocess.Popen(cmd)
    before = _snapshot()
    try:
        while True:
            time.sleep(1)
            now = _snapshot()
            if now == before:
                continue
            before = now
            print("変更を見つけたので起動し直す", file=sys.stderr, flush=True)
            child.terminate()
            child.wait()
            child = subprocess.Popen(cmd)
    except KeyboardInterrupt:
        pass
    finally:
        child.terminate()
        child.wait()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="REST API をローカルで動かす開発用の HTTP サーバー"
    )
    # compose がコンテナの 3000 番をホストに公開するので、コンテナの中では全てのアドレスで待ち受ける
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--no-reload", action="store_true", help="ファイルの変更で起動し直さない")
    args = parser.parse_args()

    origins = frozenset(
        s.strip()
        for s in os.environ.get("API_CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
        if s.strip()
    )
    if args.no_reload:
        serve(args.host, args.port, origins)
    else:
        run_with_reload(["--host", args.host, "--port", str(args.port)])


if __name__ == "__main__":
    main()
