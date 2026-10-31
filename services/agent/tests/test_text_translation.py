"""テキスト翻訳のストリームの読み方。OpenAI は偽物に差し替える。"""

import asyncio
from collections.abc import AsyncIterator
from types import SimpleNamespace
from typing import Any, cast

import pytest

from voice_intercom_agent.text_translation import TextTranslator, TranslationCutOff


def delta(text: str) -> SimpleNamespace:
    return SimpleNamespace(type="response.output_text.delta", delta=text)


COMPLETED = SimpleNamespace(type="response.completed")
FAILED = SimpleNamespace(type="response.failed", response=SimpleNamespace(error="server_error"))
INCOMPLETE = SimpleNamespace(
    type="response.incomplete",
    response=SimpleNamespace(incomplete_details="max_output_tokens"),
)
ERROR = SimpleNamespace(type="error", code="x", message="y")


def translator(*events: object) -> TextTranslator:
    async def stream() -> AsyncIterator[object]:
        for ev in events:
            yield ev

    async def create(**_: object) -> AsyncIterator[object]:
        return stream()

    client = SimpleNamespace(responses=SimpleNamespace(create=create))
    return TextTranslator(cast(Any, client), "m")


def collect(t: TextTranslator) -> tuple[list[str], Exception | None]:
    got: list[str] = []

    async def main() -> Exception | None:
        try:
            async for part in t.stream("はい", "ja", "en"):
                got.append(part)
        except Exception as e:
            return e
        return None

    return got, asyncio.run(main())


def test_completed_stream_returns_all_deltas() -> None:
    assert collect(translator(delta("Ye"), delta("s"), COMPLETED)) == (["Ye", "s"], None)


@pytest.mark.parametrize("end", [FAILED, INCOMPLETE, ERROR])
def test_cut_off_response_raises_after_partial_text(end: SimpleNamespace) -> None:
    got, error = collect(translator(delta("Ye"), end))
    assert got == ["Ye"]
    assert isinstance(error, TranslationCutOff)


def test_stream_without_a_final_event_raises() -> None:
    _, error = collect(translator(delta("Ye")))
    assert isinstance(error, TranslationCutOff)


def test_translate_all_raises_on_cut_off_response() -> None:
    t = translator(delta('{"en": "Ye'), INCOMPLETE)

    async def main() -> None:
        async for _ in t.translate_all("はい", "ja", ["en"]):
            pass

    with pytest.raises(TranslationCutOff):
        asyncio.run(main())
