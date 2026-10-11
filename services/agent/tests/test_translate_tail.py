"""TranslateSession の終わり方(session.close の前の無音)。通信はしない。"""

import asyncio
import base64
from typing import Any, cast

from voice_intercom_agent.realtime import INPUT_SAMPLE_RATE, TranslateSession


class FakeWs:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, data: dict[str, Any]) -> None:
        self.sent.append(data)


def session(tail_silence_s: float) -> TranslateSession:
    return TranslateSession(
        cast(Any, None),
        "key",
        model="gpt-realtime-translate",
        language="en",
        close_timeout_s=40,
        tail_silence_s=tail_silence_s,
        on_audio=lambda _: None,
        on_done=lambda: None,
    )


def end(s: TranslateSession, *, appended: bool) -> list[dict[str, Any]]:
    ws = FakeWs()
    if appended:
        s._on_append()  # pyright: ignore[reportPrivateUsage]
    asyncio.run(s._send_end(cast(Any, ws)))  # pyright: ignore[reportPrivateUsage]
    return ws.sent


def test_sends_tail_silence_before_close() -> None:
    sent = end(session(0.5), appended=True)
    assert sent[-1] == {"type": "session.close"}
    appends = sent[:-1]
    assert {e["type"] for e in appends} == {"session.input_audio_buffer.append"}
    pcm = b"".join(base64.b64decode(e["audio"]) for e in appends)
    assert len(pcm) == INPUT_SAMPLE_RATE // 2 * 2
    assert pcm == bytes(len(pcm))


def test_zero_tail_silence_closes_immediately() -> None:
    assert end(session(0), appended=True) == [{"type": "session.close"}]


def test_no_tail_silence_without_audio() -> None:
    # 音声を送っていない発話に、無音だけを送って課金しない
    assert end(session(0.5), appended=False) == [{"type": "session.close"}]
