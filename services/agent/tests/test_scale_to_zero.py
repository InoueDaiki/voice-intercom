import asyncio
import functools
from collections.abc import Callable, Coroutine, Iterable
from typing import Any, cast

import pytest

from voice_intercom_agent import scale_to_zero
from voice_intercom_agent.scale_to_zero import (
    DISPATCH_PENDING_S,
    IdlePolicy,
    LiveKitRooms,
    RoomState,
    catch_up,
    catch_up_enabled,
    idle_shutdown,
    is_pending,
    needs_dispatch,
)


def run_async(f: Callable[[], Coroutine[Any, Any, None]]) -> Callable[[], None]:
    """async のテストを asyncio.run で動かす(pytest の async のプラグインは入れていない)。"""

    @functools.wraps(f)
    def wrapper() -> None:
        asyncio.run(f())

    return wrapper


def test_needs_dispatch() -> None:
    # 人がいて Agent がおらず、割り当ても受けられていないルームだけ
    assert needs_dispatch(RoomState("a", 1, has_agent=False, dispatch_taken=False))
    assert not needs_dispatch(RoomState("empty", 0, has_agent=False, dispatch_taken=False))
    assert not needs_dispatch(RoomState("served", 2, has_agent=True, dispatch_taken=True))
    # 割り当てを受けた Agent がまだ入っていない途中
    assert not needs_dispatch(RoomState("joining", 1, has_agent=False, dispatch_taken=True))


def test_idle_policy_counts_from_start_and_resets_on_jobs() -> None:
    policy = IdlePolicy(idle_s=600, now=0)
    assert not policy.observe(0, 599)
    # 起動してからジョブが無いまま 10 分
    assert policy.observe(0, 600)

    policy = IdlePolicy(idle_s=600, now=0)
    assert not policy.observe(1, 500)
    # ジョブが 0 に戻ったところから数え直す
    assert not policy.observe(0, 700)
    assert not policy.observe(0, 1299)
    assert policy.observe(0, 1300)

    policy.reset(1300)
    assert not policy.observe(0, 1800)
    assert policy.observe(0, 1900)


class FakeRooms(LiveKitRooms):
    def __init__(self, states: list[RoomState], fail: bool = False) -> None:
        super().__init__("ws://lk", "k", "s", "voice-intercom")
        self.states = states
        self.fail = fail
        self.dispatched: list[str] = []
        self.listed = 0

    async def rooms(self) -> list[RoomState]:
        self.listed += 1
        if self.fail:
            raise RuntimeError("LiveKit に届かない")
        return self.states

    async def dispatch(self, rooms: Iterable[str]) -> None:
        self.dispatched.extend(rooms)


@run_async
async def test_catch_up_dispatches_only_rooms_without_agent() -> None:
    rooms = FakeRooms(
        [
            RoomState("waiting", 1, has_agent=False, dispatch_taken=False),
            RoomState("served", 1, has_agent=True, dispatch_taken=True),
            RoomState("empty", 0, has_agent=False, dispatch_taken=False),
        ]
    )
    await catch_up(rooms, delay_s=0)
    assert rooms.dispatched == ["waiting"]


@run_async
async def test_catch_up_does_not_raise() -> None:
    # LiveKit に届かなくても Agent は止めない
    await catch_up(FakeRooms([], fail=True), delay_s=0)


@run_async
async def test_idle_shutdown_stops_after_idle() -> None:
    stopped: list[bool] = []
    rooms = FakeRooms([RoomState("empty", 0, has_agent=False, dispatch_taken=False)])
    await asyncio.wait_for(
        idle_shutdown(lambda: 0, rooms, lambda: stopped.append(True), idle_s=0, poll_s=0.01),
        timeout=1,
    )
    assert stopped == [True]


@run_async
async def test_idle_shutdown_waits_while_people_are_in_rooms() -> None:
    stopped: list[bool] = []
    rooms = FakeRooms([RoomState("busy", 1, has_agent=False, dispatch_taken=True)])
    task = asyncio.create_task(
        idle_shutdown(lambda: 0, rooms, lambda: stopped.append(True), idle_s=0, poll_s=0.01)
    )
    await asyncio.sleep(0.1)
    assert stopped == []
    assert rooms.listed >= 2
    # 人がいなくなれば止める
    rooms.states = []
    await asyncio.wait_for(task, timeout=1)
    assert stopped == [True]


@run_async
async def test_idle_shutdown_retries_when_stop_fails() -> None:
    calls: list[int] = []

    def stop() -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("AccessDenied")

    await asyncio.wait_for(
        idle_shutdown(lambda: 0, FakeRooms([]), stop, idle_s=0, poll_s=0.01), timeout=1
    )
    assert len(calls) == 2


@pytest.fixture(autouse=True)
def _quiet(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("CRITICAL")


def test_needs_dispatch_waits_for_pending_dispatch() -> None:
    room = RoomState("a", 1, has_agent=False, dispatch_taken=False, dispatch_pending=True)
    assert not needs_dispatch(room)


def test_is_pending_only_for_fresh_empty_dispatches() -> None:
    now = 1_000_000.0
    created = int((now - 5) * 1e9)
    assert is_pending(0, created, 0, now)
    assert not is_pending(1, created, 0, now)
    # 消された割り当て
    assert not is_pending(0, created, 1, now)
    # 時間がたっても空のままの割り当ては、渡されずに残ったもの
    assert not is_pending(0, int((now - DISPATCH_PENDING_S - 1) * 1e9), 0, now)


class SequenceRooms(FakeRooms):
    """rooms() を呼ぶたびに、順に次の様子を返す。"""

    def __init__(self, *states: list[RoomState]) -> None:
        super().__init__([])
        self.sequence = list(states)

    async def rooms(self) -> list[RoomState]:
        self.listed += 1
        return self.sequence.pop(0)


@run_async
async def test_catch_up_rechecks_pending_dispatch_until_it_goes_stale() -> None:
    pending = RoomState("a", 1, has_agent=False, dispatch_taken=False, dispatch_pending=True)
    stale = RoomState("a", 1, has_agent=False, dispatch_taken=False)
    rooms = SequenceRooms([pending], [stale])
    await catch_up(rooms, delay_s=0, retry_s=0)
    assert rooms.dispatched == ["a"]
    assert rooms.listed == 2


@run_async
async def test_catch_up_stops_when_pending_dispatch_is_taken() -> None:
    pending = RoomState("a", 1, has_agent=False, dispatch_taken=False, dispatch_pending=True)
    taken = RoomState("a", 1, has_agent=False, dispatch_taken=True)
    rooms = SequenceRooms([pending], [taken])
    await catch_up(rooms, delay_s=0, retry_s=0)
    assert rooms.dispatched == []


@pytest.mark.parametrize(
    ("value", "idle_enabled", "expected"),
    [
        (None, True, True),
        (None, False, False),
        ("1", False, True),
        ("0", True, False),
    ],
)
def test_catch_up_runs_by_default_only_with_scale_to_zero(
    monkeypatch: pytest.MonkeyPatch, value: str | None, idle_enabled: bool, expected: bool
) -> None:
    monkeypatch.delenv("CATCH_UP_DISPATCH", raising=False)
    if value is not None:
        monkeypatch.setenv("CATCH_UP_DISPATCH", value)
    assert catch_up_enabled(idle_enabled) is expected


def test_registering_again_stops_previous_catch_up(monkeypatch: pytest.MonkeyPatch) -> None:
    # つなぎ直して登録し直したときに、前の catch_up が残ると同じルームを二重に割り当てる
    for name in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        monkeypatch.setenv(name, "x")
    monkeypatch.setenv("CATCH_UP_DISPATCH", "1")
    running: list[int] = []
    cancelled: list[int] = []

    async def fake_catch_up(_rooms: object, _delay_s: float) -> None:
        run_id = len(running)
        running.append(run_id)
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.append(run_id)
            raise

    monkeypatch.setattr(scale_to_zero, "catch_up", fake_catch_up)

    class FakeServer:
        def __init__(self) -> None:
            self.handler: Callable[[], None] | None = None

        def on(self, _event: str, handler: Callable[[], None]) -> None:
            self.handler = handler

    async def main() -> None:
        server = FakeServer()
        scale_to_zero.install(cast(Any, server), "voice-intercom")
        assert server.handler is not None
        server.handler()
        await asyncio.sleep(0)
        server.handler()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert running == [0, 1]
        assert cancelled == [0]
        for task in asyncio.all_tasks() - {asyncio.current_task()}:
            task.cancel()

    asyncio.run(main())
