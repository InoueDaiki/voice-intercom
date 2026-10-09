"""OpenAPI を標準出力に出す。`mise run gen` から呼ぶ。

uv run python -m voice_intercom_api.openapi > packages/api-client/openapi.json
"""

import json

from voice_intercom_api.app import app


def render() -> str:
    # 生成物の差分が読みやすいよう、整形して末尾に改行を付ける
    schema = json.loads(app.get_openapi_json_schema())
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    print(render(), end="")
