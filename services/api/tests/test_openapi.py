from pathlib import Path

from voice_intercom_api.openapi import render

SPEC = Path(__file__).parents[3] / "packages/api-client/openapi.json"


def test_spec_is_up_to_date() -> None:
    # クライアントの生成元がモデルとずれていないか確かめる。落ちたら `mise run gen` を実行する
    assert SPEC.read_text() == render()
