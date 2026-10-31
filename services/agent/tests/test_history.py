"""履歴の保存(history.py)。HTTP はローカルに立てた偽のサーバー(OIDC と API)に差し替える。"""

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from voice_intercom_agent import history
from voice_intercom_agent.history import (
    ClientCredentials,
    HistoryRecorder,
    HistorySettings,
    PutResult,
    TimelineClient,
    format_time,
    to_source_id,
)

T0 = datetime(2026, 10, 10, 1, 2, 3, 456789, tzinfo=UTC)


@dataclass
class FakeServer:
    """模擬 OIDC(探索とトークン)と、API の PUT /rooms/{room_id}/timeline/{source_id}。"""

    # PUT に順に返すステータス。尽きたら 200
    put_statuses: list[int] = field(default_factory=list)
    token_expires_in: int = 3600
    token_count: int = 0
    discovery_count: int = 0
    # (room_id, source_id, Authorization, body)
    puts: list[tuple[str, str, str, dict[str, Any]]] = field(default_factory=list)
    token_requests: list[dict[str, str]] = field(default_factory=list)
    # PUT の応答を遅らせる(秒)
    put_delay_s: float = 0.0

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/default/.well-known/openid-configuration", self._discovery)
        app.router.add_post("/default/token", self._token)
        app.router.add_put("/rooms/{room_id}/timeline/{source_id}", self._put)
        return app

    async def _discovery(self, request: web.Request) -> web.Response:
        self.discovery_count += 1
        base = f"{request.scheme}://{request.host}"
        return web.json_response({"token_endpoint": f"{base}/default/token"})

    async def _token(self, request: web.Request) -> web.Response:
        self.token_count += 1
        form = await request.post()
        self.token_requests.append(
            {
                "grant_type": str(form.get("grant_type")),
                "scope": str(form.get("scope")),
                "authorization": request.headers.get("Authorization", ""),
            }
        )
        return web.json_response(
            {
                "access_token": f"token-{self.token_count}",
                "token_type": "Bearer",
                "expires_in": self.token_expires_in,
            }
        )

    async def _put(self, request: web.Request) -> web.Response:
        body = await request.json()
        self.puts.append(
            (
                request.match_info["room_id"],
                request.match_info["source_id"],
                request.headers.get("Authorization", ""),
                body,
            )
        )
        if self.put_delay_s:
            await asyncio.sleep(self.put_delay_s)
        status = self.put_statuses.pop(0) if self.put_statuses else 200
        if status == 200:
            return web.json_response({"event_id": f"{body.get('occurred_at')}#x"})
        return web.json_response({"message": "error"}, status=status)


Run = Callable[[FakeServer, HistorySettings, aiohttp.ClientSession], Awaitable[None]]


def run(test: Run, server: FakeServer | None = None, **overrides: Any) -> FakeServer:
    """偽のサーバーを立て、そこに向けた設定で test を動かす。"""
    fake = server or FakeServer()

    async def main() -> None:
        async with TestServer(fake.app()) as ts, aiohttp.ClientSession() as http:
            base = str(ts.make_url("")).rstrip("/")
            settings = HistorySettings(
                api_base_url=base,
                client_id="agent",
                client_secret="secret",
                token_url=None,
                issuer=f"{base}/default",
                translation_wait_s=5.0,
                max_attempts=3,
                retry_base_s=0.01,
                request_timeout_s=2.0,
                flush_timeout_s=2.0,
            )
            await test(fake, replace(settings, **overrides), http)

    asyncio.run(main())
    return fake


def make_recorder(settings: HistorySettings, http: aiohttp.ClientSession) -> HistoryRecorder:
    client = TimelineClient(http, settings, ClientCredentials(http, settings))
    return HistoryRecorder(
        client,
        lambda: "room-1",
        translation_wait_s=settings.translation_wait_s,
        flush_timeout_s=settings.flush_timeout_s,
    )


def original(recorder: HistoryRecorder, segment_id: str, targets: list[str]) -> None:
    recorder.original(
        segment_id,
        "明日の午後3時に",
        sender_id="user-sub-1",
        language="ja",
        occurred_at=T0,
        targets=targets,
        utterance_id="utt1",
        segment_index=2,
    )


async def settle() -> None:
    # バックグラウンドの PUT が終わるまで待つ
    for _ in range(50):
        await asyncio.sleep(0.01)


# ---- 値の形 ----


def test_format_time_is_utc_with_milliseconds() -> None:
    assert format_time(T0) == "2026-10-10T01:02:03.456Z"


def test_source_id_keeps_valid_ids_and_hashes_others() -> None:
    assert to_source_id("0123abcdef_-XYZ") == "0123abcdef_-XYZ"
    converted = to_source_id("a b/c")
    assert len(converted) == 64
    assert converted == to_source_id("a b/c")
    assert history.SOURCE_ID_PATTERN.fullmatch(to_source_id("x" * 200))


def test_settings_from_env_needs_all_values(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("API_BASE_URL", "AGENT_CLIENT_ID", "AGENT_CLIENT_SECRET", "OIDC_TOKEN_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OIDC_ISSUER", "http://oidc/default")
    assert HistorySettings.from_env() is None

    monkeypatch.setenv("API_BASE_URL", "http://api/")
    monkeypatch.setenv("AGENT_CLIENT_ID", "agent")
    monkeypatch.setenv("AGENT_CLIENT_SECRET", "secret")
    settings = HistorySettings.from_env()
    assert settings is not None
    assert settings.api_base_url == "http://api"
    assert settings.token_url is None
    assert settings.issuer == "http://oidc/default"


# ---- トークン ----


def test_token_is_reused_until_near_expiry() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        now = [0.0]
        creds = ClientCredentials(http, settings, clock=lambda: now[0])
        assert await creds.token() == "token-1"
        now[0] = 3600 - history.TOKEN_REFRESH_MARGIN_S - 1
        assert await creds.token() == "token-1"
        # 期限の少し前になったら取り直す
        now[0] += 2
        assert await creds.token() == "token-2"
        assert fake.token_count == 2
        # 探索は1回だけ
        assert fake.discovery_count == 1

    fake = run(test)
    req = fake.token_requests[0]
    assert req["grant_type"] == "client_credentials"
    assert req["scope"] == "voice-intercom/agent"
    assert req["authorization"] == aiohttp.encode_basic_auth("agent", "secret")


def test_token_url_from_settings_skips_discovery() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        creds = ClientCredentials(http, replace(settings, token_url=f"{settings.issuer}/token"))
        assert await creds.token() == "token-1"
        assert fake.discovery_count == 0

    run(test)


def test_concurrent_requests_fetch_token_once() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        creds = ClientCredentials(http, settings)
        tokens = await asyncio.gather(*(creds.token() for _ in range(5)))
        assert set(tokens) == {"token-1"}
        assert fake.token_count == 1

    run(test)


# ---- PUT と再送 ----


def test_401_refetches_token_and_retries_once() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        client = TimelineClient(http, settings, ClientCredentials(http, settings))
        assert await client.put("room-1", "seg1", {"text": "x"}) is PutResult.SAVED

    fake = run(test, FakeServer(put_statuses=[401]))
    assert [p[2] for p in fake.puts] == ["Bearer token-1", "Bearer token-2"]


def test_401_twice_gives_up() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        client = TimelineClient(http, settings, ClientCredentials(http, settings))
        assert await client.put("room-1", "seg1", {"text": "x"}) is PutResult.REJECTED

    fake = run(test, FakeServer(put_statuses=[401, 401]))
    assert len(fake.puts) == 2


def test_5xx_is_retried_with_backoff() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        client = TimelineClient(http, settings, ClientCredentials(http, settings))
        assert await client.put("room-1", "seg1", {"text": "x"}) is PutResult.SAVED

    fake = run(test, FakeServer(put_statuses=[503, 500]))
    assert len(fake.puts) == 3
    # トークンは使い回す
    assert fake.token_count == 1


def test_5xx_gives_up_after_max_attempts() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        client = TimelineClient(http, settings, ClientCredentials(http, settings))
        assert await client.put("room-1", "seg1", {"text": "x"}) is PutResult.FAILED

    fake = run(test, FakeServer(put_statuses=[500, 502, 503, 504]))
    assert len(fake.puts) == 3


def test_404_is_not_retried() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        client = TimelineClient(http, settings, ClientCredentials(http, settings))
        assert await client.put("room-1", "seg1", {"text": "x"}) is PutResult.NOT_FOUND

    fake = run(test, FakeServer(put_statuses=[404]))
    assert len(fake.puts) == 1


def test_connection_error_is_retried() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        # 先に別のポートで失敗させ、トークンエンドポイントに届かない失敗も再送の対象にする
        creds = ClientCredentials(http, replace(settings, token_url="http://127.0.0.1:1/token"))
        client = TimelineClient(http, settings, creds)
        assert await client.put("room-1", "seg1", {"text": "x"}) is PutResult.FAILED
        assert fake.puts == []

    run(test)


# ---- そろったら1回だけ送る ----


def test_sends_once_when_original_and_all_translations_arrive() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        original(recorder, "seg1", ["en", "ko"])
        recorder.translation("seg1", "en", "At 3 pm tomorrow")
        await settle()
        assert fake.puts == []
        recorder.translation("seg1", "ko", "내일 오후 3시에")
        await settle()
        assert len(fake.puts) == 1
        # 遅れて同じ区切りの訳が来ても、送り直さない
        recorder.translation("seg1", "en", "again")
        await recorder.aclose()
        assert len(fake.puts) == 1

    fake = run(test)
    room_id, source_id, auth, body = fake.puts[0]
    assert (room_id, source_id, auth) == ("room-1", "seg1", "Bearer token-1")
    assert body == {
        "kind": "utterance",
        "sender_id": "user-sub-1",
        "occurred_at": "2026-10-10T01:02:03.456Z",
        "language": "ja",
        "text": "明日の午後3時に",
        "translations": {"en": "At 3 pm tomorrow", "ko": "내일 오후 3시에"},
        "utterance_id": "utt1",
        "segment_index": 2,
    }


def test_failed_translation_counts_as_resolved_and_is_omitted() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        original(recorder, "seg1", ["en", "ko"])
        recorder.translation("seg1", "en", "At 3 pm tomorrow")
        recorder.translation("seg1", "ko", None)
        await settle()
        assert len(fake.puts) == 1
        assert fake.puts[0][3]["translations"] == {"en": "At 3 pm tomorrow"}

    run(test)


def test_no_targets_sends_immediately() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        original(recorder, "seg1", [])
        await settle()
        assert len(fake.puts) == 1
        assert fake.puts[0][3]["translations"] == {}

    run(test)


def test_empty_original_is_not_saved() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        recorder.original(
            "seg1",
            " ",
            sender_id="u",
            language="ja",
            occurred_at=T0,
            targets=[],
            utterance_id="utt1",
            segment_index=0,
        )
        await recorder.aclose()
        assert fake.puts == []

    run(test)


def test_waits_for_missing_translation_up_to_limit() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        original(recorder, "seg1", ["en", "ko"])
        recorder.translation("seg1", "en", "At 3 pm tomorrow")
        await asyncio.sleep(0.05)
        assert fake.puts == []
        await asyncio.sleep(0.3)
        assert len(fake.puts) == 1
        assert fake.puts[0][3]["translations"] == {"en": "At 3 pm tomorrow"}
        # 上限の後に届いた訳は無視する
        recorder.translation("seg1", "ko", "내일")
        await recorder.aclose()
        assert len(fake.puts) == 1

    run(test, translation_wait_s=0.2)


# ---- ジョブの終わり ----


def test_aclose_flushes_pending_segments() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        original(recorder, "seg1", ["en", "ko"])
        recorder.translation("seg1", "en", "At 3 pm tomorrow")
        # 訳だけが届いた区切り(原文が無い)は保存しない
        recorder.translation("seg2", "en", "orphan")
        await recorder.aclose()
        assert [p[1] for p in fake.puts] == ["seg1"]
        assert fake.puts[0][3]["translations"] == {"en": "At 3 pm tomorrow"}
        # 閉じた後は受け付けない
        original(recorder, "seg3", [])
        await settle()
        assert len(fake.puts) == 1

    run(test)


def test_aclose_waits_for_in_flight_puts_and_gives_up_after_timeout() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        original(recorder, "seg1", [])
        await asyncio.sleep(0.05)
        started = asyncio.get_running_loop().time()
        await recorder.aclose()
        elapsed = asyncio.get_running_loop().time() - started
        # 上限(0.2秒)で打ち切る
        assert 0.1 < elapsed < 1.0

    fake = run(test, FakeServer(put_delay_s=1.5), flush_timeout_s=0.2)
    assert len(fake.puts) == 1


def test_aclose_retries_until_saved() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        original(recorder, "seg1", ["en"])
        await recorder.aclose()
        assert len(fake.puts) == 2

    run(test, FakeServer(put_statuses=[503]))


def test_disabled_recorder_does_nothing() -> None:
    async def main() -> None:
        recorder = HistoryRecorder(None, lambda: "room-1")
        assert not recorder.enabled
        original(recorder, "seg1", [])
        recorder.translation("seg1", "en", "x")
        await recorder.aclose()

    asyncio.run(main())


def test_body_is_json_serializable() -> None:
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        recorder.original(
            "seg1",
            "hello",
            sender_id="u",
            language=None,
            occurred_at=T0,
            targets=[],
            kind="text",
            message_id="m1",
        )
        await recorder.aclose()

    fake = run(test)
    body = fake.puts[0][3]
    assert json.loads(json.dumps(body)) == {
        "kind": "text",
        "sender_id": "u",
        "occurred_at": "2026-10-10T01:02:03.456Z",
        "language": None,
        "text": "hello",
        "translations": {},
        "message_id": "m1",
    }


@pytest.mark.parametrize("message_id", ["", "x" * 129])
def test_text_without_usable_message_id(message_id: str) -> None:
    # 空か API の上限を超える message_id は入れない(保存は続ける)
    async def test(fake: FakeServer, settings: HistorySettings, http: aiohttp.ClientSession):
        recorder = make_recorder(settings, http)
        recorder.original(
            "seg1",
            "hello",
            sender_id="u",
            language=None,
            occurred_at=T0,
            targets=[],
            kind="text",
            message_id=message_id,
        )
        await recorder.aclose()

    fake = run(test)
    assert "message_id" not in fake.puts[0][3]


def test_put_does_not_retry_conflict() -> None:
    # アーカイブされたルームなどで拒まれたら、再送を続けない
    async def test(fake: FakeServer, s: HistorySettings, http: aiohttp.ClientSession) -> None:
        client = TimelineClient(http, s, ClientCredentials(http, s))
        assert await client.put("room-1", "seg1", {"text": "x"}) is PutResult.REJECTED

    fake = run(test, FakeServer(put_statuses=[409]))
    assert len(fake.puts) == 1
