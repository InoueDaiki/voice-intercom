"""ECS のタスク保護(Task Scale-in Protection)。ジョブ(ルーム)を持っている間だけ付ける。

Fargate の stopTimeout は 120 秒までなので、スケールインやデプロイでタスクが止められると、
長いルームは切れる。保護中のタスクは、オートスケールのスケールインでもデプロイでも止められない。

- 保護は ECS エージェントのエンドポイント(`$ECS_AGENT_URI/task-protection/v1/state`)に PUT して
  付け外しする。`ECS_AGENT_URI` が無い環境(ローカル)では何もしない。
- livekit-agents(1.8)は Linux ではジョブごとに子プロセスを作る。ジョブの数はワーカーの
  プロセス(子プロセスを持つ親)でしか分からないので、ワーカーの `active_jobs` を 2 秒ごとに数える。
  ジョブの開始・終了を知らせる公開のイベントは無い(AgentServer のイベントは worker_started と
  worker_registered だけ。プロセスプールのイベントは非公開)。ジョブは子プロセスが終わると
  `active_jobs` から消える。ジョブを受けてから保護が付くまでの数秒は保護されない。
- ジョブが 0 から 1 以上になったら保護を付け、0 に戻ったら外す。保護には期限があるので、
  ジョブがある間は定期的に延長する。期限は短め(既定 60 分)にして、Agent が落ちたときに
  保護が残り続けないようにする。
- ジョブが絶えないタスクは、いつまでも止められなくなる(デプロイが終わらない)。そこで、
  保護を続ける長さに上限(既定 12 時間)を置き、上限を過ぎたら延長をやめて期限切れに任せる。
- エンドポイントの失敗でジョブは止めない(ログに残し、少し置いてやり直す)。

判断(ProtectionPolicy)は HTTP と LiveKit に依存しない形にして、単体テストで確かめる。
"""

import asyncio
import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum, auto
from typing import TYPE_CHECKING, Any

import aiohttp

if TYPE_CHECKING:
    from livekit.agents import AgentServer

logger = logging.getLogger(__name__)

ENDPOINT_PATH = "/task-protection/v1/state"
# ExpiresInMinutes に指定できる範囲(公式: 1〜2880 分)
MIN_EXPIRES_MIN = 1
MAX_EXPIRES_MIN = 2880


class Op(Enum):
    PROTECT = auto()  # 付ける・延長する(期限は呼ぶたびに今から数え直される)
    UNPROTECT = auto()


@dataclass(frozen=True)
class ProtectionRules:
    """保護の期限と延長の間隔(分)と、保護を続ける上限(時間)。"""

    # 1回の PUT で付ける保護の長さ。Agent が落ちたら、この長さで保護が切れる
    expires_min: int = 60
    # ジョブがある間、この間隔で延長する。expires_min より十分短くし、延長の失敗に備える
    renew_min: float = 20
    # 保護を続ける長さの上限。0 なら上限なし
    max_hours: float = 12
    # PUT が失敗したとき、次に試すまでの秒数
    retry_s: float = 30

    def __post_init__(self) -> None:
        if not MIN_EXPIRES_MIN <= self.expires_min <= MAX_EXPIRES_MIN:
            raise ValueError(
                f"保護の期限は {MIN_EXPIRES_MIN}〜{MAX_EXPIRES_MIN} 分: {self.expires_min}"
            )
        if not 0 < self.renew_min < self.expires_min:
            raise ValueError(f"延長の間隔は 0 より大きく、期限より短く: {self.renew_min}")
        if self.max_hours < 0:
            raise ValueError(f"保護を続ける上限は 0 以上: {self.max_hours}")

    @classmethod
    def from_env(cls) -> ProtectionRules:
        d = cls()
        return cls(
            expires_min=int(os.environ.get("TASK_PROTECTION_EXPIRES_MIN", d.expires_min)),
            renew_min=float(os.environ.get("TASK_PROTECTION_RENEW_MIN", d.renew_min)),
            max_hours=float(os.environ.get("TASK_PROTECTION_MAX_HOURS", d.max_hours)),
        )


class ProtectionPolicy:
    """ジョブの数の変化から、保護を付ける・外す・延長するかを決める。時刻は秒(単調増加)。

    decide で返した操作の結果を、必ず done で知らせる。
    """

    def __init__(self, rules: ProtectionRules) -> None:
        self._rules = rules
        self._jobs = 0
        # 保護を付けた(ECS が受け付けた)と分かっているか
        self._protected = False
        # ジョブがある状態が始まった時刻。上限の判断に使う
        self._busy_since: float | None = None
        self._renewed_at = 0.0
        self._next_try = 0.0
        self._capped = False

    @property
    def protected(self) -> bool:
        return self._protected

    def decide(self, jobs: int, now: float) -> Op | None:
        if jobs != self._jobs:
            if self._jobs == 0:
                self._busy_since = now
                # 0 → 1 は、失敗の待ち時間を置かずにすぐ付ける
                self._next_try = 0.0
            elif jobs == 0:
                self._busy_since = None
                self._capped = False
                self._next_try = 0.0
            self._jobs = jobs
        if now < self._next_try:
            return None
        if jobs == 0:
            return Op.UNPROTECT if self._protected else None
        if self._over_limit(now):
            if not self._capped:
                self._capped = True
                logger.warning(
                    "保護を続ける上限(%s 時間)を過ぎたので、延長をやめる(%d 分以内に切れる)",
                    self._rules.max_hours,
                    self._rules.expires_min,
                )
            return None
        if not self._protected or now - self._renewed_at >= self._rules.renew_min * 60:
            return Op.PROTECT
        return None

    def done(self, op: Op, *, ok: bool, now: float) -> None:
        if not ok:
            self._next_try = now + self._rules.retry_s
            return
        self._next_try = 0.0
        if op is Op.PROTECT:
            self._protected = True
            self._renewed_at = now
        else:
            self._protected = False

    def _over_limit(self, now: float) -> bool:
        if self._rules.max_hours <= 0 or self._busy_since is None:
            return False
        return now - self._busy_since >= self._rules.max_hours * 3600


class TaskProtector:
    """ジョブの数を定期的に見て、ECS エージェントのエンドポイントで保護を付け外しする。"""

    def __init__(
        self,
        agent_uri: str,
        rules: ProtectionRules,
        count_jobs: Callable[[], int],
        *,
        poll_s: float = 2.0,
    ) -> None:
        self._url = agent_uri.rstrip("/") + ENDPOINT_PATH
        self._rules = rules
        self._count_jobs = count_jobs
        self._poll_s = poll_s
        self._policy = ProtectionPolicy(rules)

    async def run(self) -> None:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            while True:
                try:
                    await self._tick(http)
                except Exception:
                    # 保護の処理が止まっても、ジョブは続ける
                    logger.exception("タスク保護の処理に失敗した")
                await asyncio.sleep(self._poll_s)

    async def _tick(self, http: aiohttp.ClientSession) -> None:
        jobs = self._count_jobs()
        op = self._policy.decide(jobs, time.monotonic())
        if op is None:
            return
        ok = await self._put(http, op)
        if ok and op is Op.PROTECT and not self._policy.protected:
            logger.info("タスク保護を付けた(ジョブ %d、%d 分)", jobs, self._rules.expires_min)
        elif ok and op is Op.UNPROTECT:
            logger.info("タスク保護を外した")
        self._policy.done(op, ok=ok, now=time.monotonic())

    async def _put(self, http: aiohttp.ClientSession, op: Op) -> bool:
        body: dict[str, Any] = {"ProtectionEnabled": op is Op.PROTECT}
        if op is Op.PROTECT:
            body["ExpiresInMinutes"] = self._rules.expires_min
        try:
            async with http.put(self._url, json=body) as resp:
                status = resp.status
                text = await resp.text()
        except Exception:
            logger.exception("タスク保護のエンドポイントに届かない(%s)", op.name)
            return False
        if status == 200 and is_success(text):
            return True
        # 例: AccessDeniedException(タスクロールの権限)、DEPLOYMENT_BLOCKED(保護中のタスクが
        # desired count より多い)、ThrottlingException、RequestCanceled(ECS の API に届かない)
        logger.warning("タスク保護の更新に失敗した(%s): %d %s", op.name, status, text)
        return False


def is_success(text: str) -> bool:
    """エンドポイントの応答の本文が成功か。成功は protection、失敗は failure か error を返す。"""
    try:
        data = json.loads(text)
    except ValueError:
        return False
    return (
        isinstance(data, dict)
        and "protection" in data
        and not (data.get("failure") or data.get("error"))
    )


def install(server: AgentServer) -> None:
    """ECS の上で動いていれば、ワーカーの起動後にタスク保護の処理を始める。

    ジョブの子プロセスもこのモジュールを読み込むが、worker_started はワーカーのプロセスでしか
    起きないので、保護の処理はワーカーに1つだけ動く。
    """
    agent_uri = os.environ.get("ECS_AGENT_URI")
    if not agent_uri:
        return
    rules = ProtectionRules.from_env()
    tasks: set[asyncio.Task[None]] = set()

    def on_worker_started() -> None:
        protector = TaskProtector(agent_uri, rules, lambda: len(server.active_jobs))
        task = asyncio.create_task(protector.run(), name="task_protection")
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        logger.info(
            "タスク保護を有効にした(期限 %d 分、延長 %s 分ごと、上限 %s 時間)",
            rules.expires_min,
            rules.renew_min,
            rules.max_hours,
        )

    server.on("worker_started", on_worker_started)
