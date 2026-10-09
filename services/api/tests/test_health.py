import json

from conftest import http_event

from voice_intercom_api.app import handler


def test_health_without_token() -> None:
    # 環境変数がなくても(設定を読まずに)応答する
    res = handler(http_event("GET", "/health"), None)  # pyright: ignore[reportArgumentType]

    assert res["statusCode"] == 200
    assert json.loads(res["body"]) == {"status": "ok"}
