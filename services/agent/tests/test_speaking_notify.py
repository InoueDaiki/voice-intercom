"""話し始めとテキストの通知(notify.py)。HTTP はローカルに立てた偽のサーバーに差し替える。"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from voice_intercom_agent.history import ClientCredentials, HistorySettings
from voice_intercom_agent.notify import (
    NotifyClient,
    NotifyResult,
    RoomNotifier,
    Throttle,
    min_interval_from_env,
    present_ids,
)

SPEAKING_BODY: dict[str, Any] = {"speaker_id": "user-a", "present_ids": []}

# ---- 判断 ----


def test_throttle_allows_once_per_interval_per_room() -> None:
    now = [0.0]
    throttle = Throttle(30.0, clock=lambda: now[0])
    assert throttle.allow("room-1")
    now[0] = 29.9
    assert not throttle.allow("room-1")
    # ほかのルームは別に数える
    assert throttle.allow("room-2")
    now[0] = 30.0
    assert throttle.allow("room-1")
    # 間引いた呼び出しでは、間隔の起点を動かさない
    now[0] = 45.0
    assert not throttle.allow("room-1")
    now[0] = 60.0
    assert throttle.allow("room-1")


def test_throttle_with_zero_interval_always_allows() -> None:
    throttle = Throttle(0.0, clock=lambda: 0.0)
    assert throttle.allow("room-1")
    assert throttle.allow("room-1")


def test_present_ids_keeps_people_only_without_duplicates() -> None:
    participants = [
        ("user-a", True),
        ("agent-xyz", False),
        ("user-b", True),
        ("user-a", True),
        ("", True),
    ]
    assert present_ids(participants) == ["user-a", "user-b"]
    assert present_ids([]) == []


def test_min_interval_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NOTIFY_MIN_INTERVAL_S", raising=False)
    assert min_interval_from_env() == 30.0
    monkeypatch.setenv("NOTIFY_MIN_INTERVAL_S", "5")
    assert min_interval_from_env() == 5.0


# ---- HTTP ----


@dataclass
class FakeServer:
    """模擬 OIDC のトークンと、API の POST /rooms/{room_id}/notifications/{kind}。"""

    # POST に順に返すステータス。尽きたら 200
    statuses: list[int] = field(default_factory=list)
    token_count: int = 0
    # (room_id, Authorization, body)
    posts: list[tuple[str, str, dict[str, Any]]] = field(default_factory=list)
    # POST の kind(speaking、text)
    kinds: list[str] = field(default_factory=list)
    # 応答を遅らせる(秒)
    delay_s: float = 0.0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/default/token", self._token)
        app.router.add_post("/rooms/{room_id}/notifications/{kind}", self._notify)
        return app

    async def _token(self, request: web.Request) -> web.Response:
        self.token_count += 1
        return web.json_response(
            {
                "access_token": f"token-{self.token_count}",
                "token_type": "Bearer",
                "expires_in": 3600,
            }
        )

    async def _notify(self, request: web.Request) -> web.Response:
        body = await request.json()
        self.kinds.append(request.match_info["kind"])
        self.posts.append(
            (request.match_info["room_id"], request.headers.get("Authorization", ""), body)
        )
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        status = self.statuses.pop(0) if self.statuses else 200
        if status == 200:
            return web.json_response({"sent": 2, "skipped": 1})
        return web.json_response({"message": "error"}, status=status)


Run = Callable[[FakeServer, NotifyClient], Awaitable[None]]


def run(test: Run, server: FakeServer | None = None) -> FakeServer:
    """偽のサーバーを立て、そこに向けた NotifyClient で test を動かす。"""
    fake = server or FakeServer()

    async def main() -> None:
        async with TestServer(fake.app()) as ts, aiohttp.ClientSession() as http:
            base = str(ts.make_url("")).rstrip("/")
            settings = HistorySettings(
                api_base_url=base,
                client_id="agent",
                client_secret="secret",
                token_url=f"{base}/default/token",
                issuer=None,
                request_timeout_s=2.0,
            )
            creds = ClientCredentials(http, settings)
            await test(fake, NotifyClient(http, settings, creds, retry_delay_s=0.01))

    asyncio.run(main())
    return fake


def test_posts_speaker_and_present_ids_with_token() -> None:
    async def test(fake: FakeServer, client: NotifyClient) -> None:
        result = await client.notify(
            "room 1", "speaking", {"speaker_id": "user-a", "present_ids": ["user-a", "user-b"]}
        )
        assert result is NotifyResult.SENT

    fake = run(test)
    assert fake.posts == [
        ("room 1", "Bearer token-1", {"speaker_id": "user-a", "present_ids": ["user-a", "user-b"]})
    ]


def test_5xx_is_retried_only_once() -> None:
    async def test(fake: FakeServer, client: NotifyClient) -> None:
        assert await client.notify("room-1", "speaking", SPEAKING_BODY) is NotifyResult.FAILED

    fake = run(test, FakeServer(statuses=[503, 502, 500]))
    assert len(fake.posts) == 2


def test_5xx_then_success() -> None:
    async def test(fake: FakeServer, client: NotifyClient) -> None:
        assert await client.notify("room-1", "speaking", SPEAKING_BODY) is NotifyResult.SENT

    fake = run(test, FakeServer(statuses=[503]))
    assert len(fake.posts) == 2


def test_401_refreshes_token_once() -> None:
    async def test(fake: FakeServer, client: NotifyClient) -> None:
        assert await client.notify("room-1", "speaking", SPEAKING_BODY) is NotifyResult.SENT

    fake = run(test, FakeServer(statuses=[401]))
    assert [auth for _, auth, _ in fake.posts] == ["Bearer token-1", "Bearer token-2"]


def test_401_twice_is_rejected() -> None:
    async def test(fake: FakeServer, client: NotifyClient) -> None:
        assert await client.notify("room-1", "speaking", SPEAKING_BODY) is NotifyResult.REJECTED

    fake = run(test, FakeServer(statuses=[401, 401]))
    assert len(fake.posts) == 2


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (404, NotifyResult.ROOM_GONE),
        (409, NotifyResult.ROOM_GONE),
        (400, NotifyResult.REJECTED),
        (403, NotifyResult.REJECTED),
        (429, NotifyResult.REJECTED),
    ],
)
def test_4xx_is_not_retried(status: int, expected: NotifyResult) -> None:
    async def test(fake: FakeServer, client: NotifyClient) -> None:
        assert await client.notify("room-1", "speaking", SPEAKING_BODY) is expected

    fake = run(test, FakeServer(statuses=[status]))
    assert len(fake.posts) == 1


def test_connection_failure_is_retried_once() -> None:
    async def main() -> None:
        async with aiohttp.ClientSession() as http:
            # 誰も待ち受けていないポート
            settings = HistorySettings(
                api_base_url="http://127.0.0.1:9",
                client_id="agent",
                client_secret="secret",
                token_url="http://127.0.0.1:9/token",
                issuer=None,
                request_timeout_s=1.0,
            )
            client = NotifyClient(
                http, settings, ClientCredentials(http, settings), retry_delay_s=0.01
            )
            assert await client.notify("room-1", "speaking", SPEAKING_BODY) is NotifyResult.FAILED

    asyncio.run(main())


# ---- バックグラウンドで送る流れ ----

NotifierRun = Callable[[FakeServer, NotifyClient, list[float]], Awaitable[None]]


def run_notifier(test: NotifierRun, server: FakeServer | None = None) -> FakeServer:
    now = [0.0]

    async def inner(fake: FakeServer, client: NotifyClient) -> None:
        await test(fake, client, now)

    return run(inner, server)


def test_notifier_sends_in_background_and_throttles() -> None:
    async def test(fake: FakeServer, client: NotifyClient, now: list[float]) -> None:
        notifier = RoomNotifier(client, lambda: "room-1", min_interval_s=30.0, clock=lambda: now[0])
        notifier.started("user-a", ["user-a", "user-b"])
        # 呼び出しはすぐ返り、まだ送っていない
        assert fake.posts == []
        now[0] = 10.0
        notifier.started("user-b", ["user-a", "user-b"])
        now[0] = 31.0
        notifier.started("user-b", ["user-b"])
        await notifier.aclose()

    fake = run_notifier(test)
    assert [body["speaker_id"] for _, _, body in fake.posts] == ["user-a", "user-b"]
    assert fake.posts[1][2]["present_ids"] == ["user-b"]


def test_notifier_without_client_does_nothing() -> None:
    async def main() -> None:
        notifier = RoomNotifier(None, lambda: "room-1")
        notifier.started("user-a", ["user-a"])
        await notifier.aclose()

    asyncio.run(main())


def test_notifier_close_gives_up_on_slow_requests() -> None:
    async def test(fake: FakeServer, client: NotifyClient, now: list[float]) -> None:
        notifier = RoomNotifier(client, lambda: "room-1", flush_timeout_s=0.1)
        notifier.started("user-a", ["user-a"])
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        await notifier.aclose()
        assert loop.time() - t0 < 1.0
        # 閉じた後の発話の開始は無視する
        notifier.started("user-b", ["user-b"])
        await asyncio.sleep(0.05)

    fake = run_notifier(test, FakeServer(delay_s=1.5))
    assert [body["speaker_id"] for _, _, body in fake.posts] == ["user-a"]


def test_notifier_posts_text() -> None:
    async def test(fake: FakeServer, client: NotifyClient, now: list[float]) -> None:
        notifier = RoomNotifier(client, lambda: "room-1", clock=lambda: now[0])
        notifier.text("user-a", ["user-a", "user-b"], "資材が届きました")
        await notifier.aclose()

    fake = run_notifier(test)
    assert fake.kinds == ["text"]
    assert fake.posts == [
        (
            "room-1",
            "Bearer token-1",
            {
                "sender_id": "user-a",
                "present_ids": ["user-a", "user-b"],
                "text": "資材が届きました",
            },
        )
    ]


def test_notifier_throttles_speaking_and_text_together() -> None:
    async def test(fake: FakeServer, client: NotifyClient, now: list[float]) -> None:
        notifier = RoomNotifier(client, lambda: "room-1", min_interval_s=30.0, clock=lambda: now[0])
        notifier.started("user-a", ["user-a"])
        now[0] = 10.0
        # 種類が違っても、同じルームの間隔の内側は呼ばない
        notifier.text("user-b", ["user-b"], "こんにちは")
        now[0] = 31.0
        notifier.text("user-b", ["user-b"], "こんにちは")
        await notifier.aclose()

    fake = run_notifier(test)
    assert fake.kinds == ["speaking", "text"]
