"""OpenAPI を標準出力に出す。`mise run gen` から呼ぶ。

uv run python -m voice_intercom_api.openapi > packages/api-client/openapi.json
"""

import json

from voice_intercom_api.app import app


def _relax_primitive_any_of(node: object) -> None:
    """配列の要素が「プリミティブ型の anyOf」なら、型を問わない要素({})にする。

    Powertools の ValidationError の loc(文字列か整数の配列)が当たる。openapi-generator の
    dart は、この anyOf から中身の無いモデル(LocationInner)を作り、Dart として壊れたコードを
    出す(アプリがビルドできない)。要素を {} にすると List<Object> になる。
    """
    if isinstance(node, dict):
        items = node.get("items")
        if isinstance(items, dict) and set(items) == {"anyOf"}:
            members = items["anyOf"]
            if all(isinstance(m, dict) and set(m) == {"type"} for m in members):
                node["items"] = {}
        for value in node.values():
            _relax_primitive_any_of(value)
    elif isinstance(node, list):
        for value in node:
            _relax_primitive_any_of(value)


def render() -> str:
    schema = json.loads(app.get_openapi_json_schema())
    _relax_primitive_any_of(schema)
    # 生成物の差分が読みやすいよう、整形して末尾に改行を付ける
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    print(render(), end="")
