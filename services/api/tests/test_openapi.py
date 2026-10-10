import json
from pathlib import Path

from voice_intercom_api.openapi import render

SPEC = Path(__file__).parents[3] / "packages/api-client/openapi.json"


def test_spec_is_up_to_date() -> None:
    # クライアントの生成元がモデルとずれていないか確かめる。落ちたら `mise run gen` を実行する
    assert SPEC.read_text() == render()


def test_no_primitive_any_of_in_array_items() -> None:
    # openapi-generator の dart は、プリミティブ型の anyOf から壊れたモデルを作る(openapi.py)
    loc = json.loads(render())["components"]["schemas"]["ValidationError"]["properties"]["loc"]
    assert loc == {"items": {}, "type": "array", "title": "Location"}
