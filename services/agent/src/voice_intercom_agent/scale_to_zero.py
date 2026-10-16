"""使っていない間は Agent を 0 台にする(dev の scale to zero)。

設計メモの「Agent の scale to zero」。

0 台からの起動は API がする(LiveKit のトークンを出すときに、ECS のサービスの台数を 1 にする)。
このモジュールは、起動した後の2つを受け持つ。

1. **割り当てのやり直し(catch up)**: LiveKit は、Agent が1台も登録していないときに作られた
   ルームの割り当て(トークンに入れた RoomAgentDispatch)を、後から登録した Agent に渡さない
   (ローカルの livekit-server 1.13.9 で確かめた。割り当ては jobs が空のまま残る)。そこで、
   登録した後に、人がいて Agent のいないルームを探し、CreateDispatch で割り当て直す。
   - 登録の直後に、普通の割り当てが届くのを少し待ってから(既定 5 秒)探す。
   - 割り当てに jobs があるルーム(ほかの Agent が受けた)と、Agent の参加者がいるルームは除く。
   - dev 以外で動いても害は無い(割り当て直すのは Agent のいないルームだけ)。
     CATCH_UP_DISPATCH=0 で止める。
2. **使われなくなったら止める(idle shutdown)**: ジョブの無い状態が IDLE_SHUTDOWN_MIN 分続いたら、
   自分の ECS のサービスの台数(desiredCount)を 0 にする。ECS がタスクに SIGTERM を送って止める。
   - 止める前に LiveKit でも、人のいるルームが無いことを確かめる(割り当てがちょうど届いた、などの
     取りこぼしを減らす)。それでも止めた直後に入った人は Agent のいないルームになるが、入り直せば
     API がまた 1 台にする。dev だけで使うので、この隙間は許す。
   - IDLE_SHUTDOWN_MIN、ECS_CLUSTER、ECS_SERVICE がそろっているときだけ動く
     (Terraform が dev で渡す)。

判断(IdlePolicy、needs_dispatch)は LiveKit と AWS に依存しない形にして、単体テストで確かめる。
"""

import asyncio
import logging
import os
import time
from collections.abc import Callable, Coroutine, Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from livekit.agents import AgentServer

logger = logging.getLogger(__name__)

# 参加者の種類(livekit の ParticipantInfo.Kind)
KIND_STANDARD = 0
KIND_AGENT = 4


@dataclass(frozen=True)
class RoomState:
    """割り当て直すかを決めるのに要る、ルームの様子。"""

    name: str
    # 人(STANDARD)の参加者の数
    people: int
    # Agent の参加者がいるか
    has_agent: bool
    # この agent_name の割り当てのうち、ジョブを受けたものがあるか
    dispatch_taken: bool


def needs_dispatch(room: RoomState) -> bool:
    """人がいて、Agent がおらず、割り当てを誰も受けていないルームか。"""
    return room.people > 0 and not room.has_agent and not room.dispatch_taken


class IdlePolicy:
    """ジョブの数の変化から、止める時刻が来たかを決める。時刻は秒(単調増加)。"""

    def __init__(self, idle_s: float, now: float) -> None:
        self._idle_s = idle_s
        # ジョブが 0 になった時刻(起動したときは 0 から数える)
        self._idle_since: float | None = now

    def observe(self, jobs: int, now: float) -> bool:
        """止めてよければ True。ジョブがある間は数え直す。"""
        if jobs > 0:
            self._idle_since = None
            return False
        if self._idle_since is None:
            self._idle_since = now
        return now - self._idle_since >= self._idle_s

    def reset(self, now: float) -> None:
        """止めるのをやめた(人がいた、台数を変えられなかった)ので、もう一度数え直す。"""
        self._idle_since = now


class LiveKitRooms:
    """LiveKit の Server API で、ルームの様子を見て割り当てを作る。"""

    def __init__(self, url: str, api_key: str, api_secret: str, agent_name: str) -> None:
        # Server API は HTTP。Agent に渡す URL は ws:// か wss:// なので読み替える
        self._url = url.replace("wss://", "https://").replace("ws://", "http://")
        self._key = api_key
        self._secret = api_secret
        self._agent_name = agent_name

    async def rooms(self) -> list[RoomState]:
        from livekit import api

        lk = api.LiveKitAPI(self._url, self._key, self._secret)
        try:
            listed = await lk.room.list_rooms(api.ListRoomsRequest())
            states: list[RoomState] = []
            for r in listed.rooms:
                if r.num_participants == 0:
                    states.append(RoomState(r.name, 0, False, False))
                    continue
                parts = await lk.room.list_participants(api.ListParticipantsRequest(room=r.name))
                kinds = [p.kind for p in parts.participants]
                dispatches = await lk.agent_dispatch.list_dispatch(room_name=r.name)
                taken = any(
                    d.agent_name == self._agent_name and len(d.state.jobs) > 0 for d in dispatches
                )
                states.append(
                    RoomState(
                        r.name,
                        sum(1 for k in kinds if k == KIND_STANDARD),
                        any(k == KIND_AGENT for k in kinds),
                        taken,
                    )
                )
            return states
        finally:
            await lk.aclose()

    async def dispatch(self, rooms: Iterable[str]) -> None:
        from livekit import api

        lk = api.LiveKitAPI(self._url, self._key, self._secret)
        try:
            for room in rooms:
                await lk.agent_dispatch.create_dispatch(
                    api.CreateAgentDispatchRequest(agent_name=self._agent_name, room=room)
                )
                logger.info("Agent のいないルームを割り当て直した: %s", room)
        finally:
            await lk.aclose()


async def catch_up(rooms: LiveKitRooms, delay_s: float) -> None:
    """登録した後に、Agent のいないルームを割り当て直す。失敗しても Agent は止めない。"""
    await asyncio.sleep(delay_s)
    try:
        targets = [r.name for r in await rooms.rooms() if needs_dispatch(r)]
        if targets:
            await rooms.dispatch(targets)
    except Exception:
        logger.exception("Agent のいないルームを割り当て直せなかった")


def set_desired_zero(cluster: str, service: str) -> None:
    """自分の ECS のサービスの台数を 0 にする(タスクロールの ecs:UpdateService)。"""
    import boto3

    boto3.client("ecs").update_service(cluster=cluster, service=service, desiredCount=0)


async def idle_shutdown(
    count_jobs: Callable[[], int],
    rooms: LiveKitRooms,
    stop: Callable[[], None],
    *,
    idle_s: float,
    poll_s: float = 30.0,
) -> None:
    """ジョブの無い状態が idle_s 秒続いたら stop を呼ぶ(台数を 0 にする)。"""
    policy = IdlePolicy(idle_s, time.monotonic())
    while True:
        await asyncio.sleep(poll_s)
        if not policy.observe(count_jobs(), time.monotonic()):
            continue
        try:
            if any(r.people > 0 for r in await rooms.rooms()):
                # 人のいるルームがある(割り当てが届く途中など)。止めずに数え直す
                policy.reset(time.monotonic())
                continue
            await asyncio.to_thread(stop)
            logger.info("使われていないので、Agent の台数を 0 にした(%d 分)", idle_s // 60)
            return
        except Exception:
            logger.exception("Agent の台数を 0 にできなかった。あとでやり直す")
            policy.reset(time.monotonic())


def install(server: AgentServer, agent_name: str) -> None:
    """ワーカーが LiveKit に登録したら、割り当てのやり直しと、使われなくなったら止める処理を始める。

    ジョブの子プロセスもこのモジュールを読み込むが、worker_registered はワーカーのプロセスでしか
    起きないので、どちらもワーカーに1つだけ動く。
    """
    url = os.environ.get("LIVEKIT_URL", "")
    key = os.environ.get("LIVEKIT_API_KEY", "")
    secret = os.environ.get("LIVEKIT_API_SECRET", "")
    if not (url and key and secret):
        return
    rooms = LiveKitRooms(url, key, secret, agent_name)
    catch_up_enabled = os.environ.get("CATCH_UP_DISPATCH", "1") != "0"
    catch_up_delay_s = float(os.environ.get("CATCH_UP_DELAY_S", "5"))
    idle_min = float(os.environ.get("IDLE_SHUTDOWN_MIN", "0"))
    cluster = os.environ.get("ECS_CLUSTER", "")
    service = os.environ.get("ECS_SERVICE", "")
    idle_enabled = idle_min > 0 and bool(cluster and service)
    tasks: set[asyncio.Task[None]] = set()

    idle_started = False

    def start(coro: Coroutine[Any, Any, None], name: str) -> None:
        task = asyncio.create_task(coro, name=name)
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    def on_registered(*_: object) -> None:
        nonlocal idle_started
        # つなぎ直して登録し直したときも、その間に作られたルームを割り当て直す
        if catch_up_enabled:
            start(catch_up(rooms, catch_up_delay_s), "catch_up_dispatch")
        # 止める処理は1つだけ
        if idle_enabled and not idle_started:
            idle_started = True
            start(
                idle_shutdown(
                    lambda: len(server.active_jobs),
                    rooms,
                    lambda: set_desired_zero(cluster, service),
                    idle_s=idle_min * 60,
                ),
                "idle_shutdown",
            )
            logger.info("使われなくなったら止める(ジョブの無い状態が %s 分続いたら)", idle_min)

    server.on("worker_registered", on_registered)
