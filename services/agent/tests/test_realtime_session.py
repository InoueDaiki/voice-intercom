"""RealtimeSession の接続と終わり方。通信はしない。"""

import asyncio
from typing import Any, cast

import pytest

from voice_intercom_agent import realtime
from voice_intercom_agent.realtime import WhisperSession


class StuckHttp:
    async def ws_connect(self, *_: object, **__: object) -> None:
        await asyncio.Event().wait()


class FailingHttp:
    async def ws_connect(self, *_: object, **__: object) -> None:
        raise ConnectionError("つながらない")


def whisper(http: object, completed: list[tuple[int, str]]) -> WhisperSession:
    return WhisperSession(
        cast(Any, http),
        "key",
        model="m",
        language="ja",
        commit_timeout_s=10,
        on_delta=lambda _i, _t: None,
        on_completed=lambda i, t: completed.append((i, t)),
    )


def queued(session: WhisperSession) -> int:
    return session._queue.qsize()  # pyright: ignore[reportPrivateUsage]


def test_push_after_the_session_ended_is_dropped() -> None:
    completed: list[tuple[int, str]] = []
    session = whisper(FailingHttp(), completed)

    async def main() -> None:
        # 接続を待つ間の音声はためるが、セッションが終わったら捨てる
        session.push(b"\x00\x00")
        assert queued(session) == 1
        await session.run()
        assert queued(session) == 0
        session.push(b"\x00\x00")
        session.split()
        session.finish()
        assert queued(session) == 0

    asyncio.run(main())
    assert completed == [(0, "")]


def test_connecting_gives_up_at_ready_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(realtime, "READY_TIMEOUT_S", 0.01)
    completed: list[tuple[int, str]] = []

    async def main() -> None:
        await asyncio.wait_for(whisper(StuckHttp(), completed).run(), timeout=1)

    asyncio.run(main())
    assert completed == [(0, "")]
