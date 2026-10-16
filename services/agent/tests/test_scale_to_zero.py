import asyncio
import functools
from collections.abc import Callable, Coroutine, Iterable
from typing import Any

import pytest

from voice_intercom_agent.scale_to_zero import (
    IdlePolicy,
    LiveKitRooms,
    RoomState,
    catch_up,
    idle_shutdown,
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
