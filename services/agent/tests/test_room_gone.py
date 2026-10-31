"""API がルームを使えないと答えたときに、ルームを閉じてジョブを終えること(agent.py)。

アーカイブや削除の後に、発行済みのトークンで作り直された LiveKit のルームを想定する。
API は偽のサーバーに、LiveKit の操作(JobContext)は偽物に差し替える。
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer
from test_shutdown import SETTINGS, FakeRoom, FakeTranslator

from voice_intercom_agent import agent as agent_module
from voice_intercom_agent.agent import IntercomAgent, close_job_room
from voice_intercom_agent.scale_to_zero import LiveKitRooms, RoomState, catch_up

T0 = datetime(2026, 10, 10, 1, 2, 3, tzinfo=UTC)

Scenario = Callable[[IntercomAgent], None]


def speak(agent: IntercomAgent) -> None:
    agent._deps.notifier.started("user-1", ["user-1"])  # pyright: ignore[reportPrivateUsage]


def text(agent: IntercomAgent) -> None:
    agent._deps.notifier.text("user-1", ["user-1"], "こんにちは")  # pyright: ignore[reportPrivateUsage]


def save(agent: IntercomAgent) -> None:
    history = agent._deps.history  # pyright: ignore[reportPrivateUsage]
    history.original(
        "seg-1", "こんにちは", sender_id="user-1", language="ja", occurred_at=T0, targets=[]
    )


class FakeApi:
    """模擬 OIDC のトークンと、履歴の PUT・通知の POST。どれも status を返す。"""

    def __init__(self, status: int) -> None:
        self.status = status
        self.calls = 0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/token", self._token)
        app.router.add_put("/rooms/{room_id}/timeline/{source_id}", self._write)
        app.router.add_post("/rooms/{room_id}/notifications/{kind}", self._write)
        return app

    async def _token(self, _: web.Request) -> web.Response:
        return web.json_response({"access_token": "token", "expires_in": 3600})

    async def _write(self, _: web.Request) -> web.Response:
        self.calls += 1
        return web.json_response({"message": "error"}, status=self.status)


async def with_agent(
    fake: FakeApi,
    monkeypatch: pytest.MonkeyPatch,
    test: Callable[[IntercomAgent], Awaitable[None]],
    close_room: Callable[[], Any],
) -> None:
    async with TestServer(fake.app()) as ts:
        base = str(ts.make_url("")).rstrip("/")
        monkeypatch.setenv("API_BASE_URL", base)
        monkeypatch.setenv("AGENT_CLIENT_ID", "agent")
        monkeypatch.setenv("AGENT_CLIENT_SECRET", "secret")
        monkeypatch.setenv("OIDC_TOKEN_URL", f"{base}/token")
        monkeypatch.delenv("RECORDING_BUCKET", raising=False)
        agent = IntercomAgent(
            cast(Any, FakeRoom()), SETTINGS, cast(Any, FakeTranslator()), close_room=close_room
        )
        try:
            await test(agent)
        finally:
            await agent.aclose()


async def settle() -> None:
    for _ in range(30):
        await asyncio.sleep(0.01)


class CloseSpy:
    def __init__(self) -> None:
        self.count = 0

    async def __call__(self) -> None:
        self.count += 1


@pytest.mark.parametrize("status", [404, 409])
@pytest.mark.parametrize("scenario", [speak, text, save])
def test_closes_room_once_when_api_says_room_is_gone(
    status: int, scenario: Scenario, monkeypatch: pytest.MonkeyPatch
) -> None:
    close = CloseSpy()

    async def test(agent: IntercomAgent) -> None:
        scenario(agent)
        await settle()
        assert close.count == 1
        # 続けて別の経路で受けても、閉じるのは1回
        save(agent)
        await settle()
        assert close.count == 1

    asyncio.run(with_agent(FakeApi(status), monkeypatch, test, close))


@pytest.mark.parametrize("status", [200, 400, 403, 422])
@pytest.mark.parametrize("scenario", [speak, text, save])
def test_other_responses_do_not_close_room(
    status: int, scenario: Scenario, monkeypatch: pytest.MonkeyPatch
) -> None:
    close = CloseSpy()

    async def test(agent: IntercomAgent) -> None:
        scenario(agent)
        await settle()
        assert close.count == 0

    asyncio.run(with_agent(FakeApi(status), monkeypatch, test, close))


def test_flush_at_job_end_does_not_close_room(monkeypatch: pytest.MonkeyPatch) -> None:
    # ジョブが普通に終わるときの送り残しで 404 を受けても、もう終わるので閉じない
    close = CloseSpy()

    async def test(agent: IntercomAgent) -> None:
        history = agent._deps.history  # pyright: ignore[reportPrivateUsage]
        history.original(
            "seg-1", "途中", sender_id="user-1", language="ja", occurred_at=T0, targets=["en"]
        )
        await agent.aclose()
        assert close.count == 0

    asyncio.run(with_agent(FakeApi(404), monkeypatch, test, close))


class FakeRooms(LiveKitRooms):
    def __init__(self, states: list[RoomState]) -> None:
        super().__init__("ws://lk", "k", "s", "voice-intercom")
        self.states = states
        self.dispatched: list[str] = []

    async def rooms(self) -> list[RoomState]:
        return self.states

    async def dispatch(self, rooms: Any) -> None:
        self.dispatched.extend(rooms)


def test_catch_up_dispatch_to_recreated_archived_room_is_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # catch_up は API を見ないので、アーカイブ後に作り直されたルームにも割り当てる。
    # 割り当てられたジョブは普通のジョブなので、最初の通知の 409 で閉じる
    rooms = FakeRooms([RoomState("archived", 1, has_agent=False, dispatch_taken=False)])
    close = CloseSpy()

    async def test(agent: IntercomAgent) -> None:
        await catch_up(rooms, delay_s=0)
        assert rooms.dispatched == ["archived"]
        speak(agent)
        await settle()
        assert close.count == 1

    asyncio.run(with_agent(FakeApi(409), monkeypatch, test, close))


class FakeContext:
    def __init__(self, delete: Callable[[], Any]) -> None:
        self._delete = delete
        self.room = SimpleNamespace(name="room-1")
        self.order: list[str] = []
        self.shutdown_reasons: list[str] = []

    def delete_room(self) -> Any:
        self.order.append("delete")
        return asyncio.ensure_future(self._delete())

    def shutdown(self, reason: str = "") -> None:
        self.order.append("shutdown")
        self.shutdown_reasons.append(reason)


def test_close_job_room_deletes_then_shuts_down() -> None:
    async def delete() -> None:
        pass

    ctx = FakeContext(delete)
    asyncio.run(close_job_room(cast(Any, ctx)))
    assert ctx.order == ["delete", "shutdown"]


def test_close_job_room_shuts_down_when_livekit_does_not_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(agent_module, "ROOM_CLOSE_TIMEOUT_S", 0.01)

    ctx = FakeContext(asyncio.Event().wait)
    asyncio.run(close_job_room(cast(Any, ctx)))
    assert ctx.order == ["delete", "shutdown"]


def test_close_job_room_shuts_down_when_delete_fails() -> None:
    async def delete() -> None:
        raise aiohttp.ClientError("届かない")

    ctx = FakeContext(delete)
    with pytest.raises(aiohttp.ClientError):
        asyncio.run(close_job_room(cast(Any, ctx)))
    assert ctx.order == ["delete", "shutdown"]
