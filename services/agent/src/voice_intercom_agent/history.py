"""確定した字幕を、REST API(PUT /rooms/{room_id}/timeline/{source_id})で履歴に保存する。

- 1つの区切り(segment_id)について、原文の確定と、翻訳先の全言語の訳の確定(か失敗)が
  そろったら、1回だけ PUT する。訳がそろうのを待つ上限は translation_wait_s で、過ぎたら
  そろった分だけで保存する。
- API は Agent の client credentials のアクセストークン(スコープ voice-intercom/agent)で呼ぶ。
  トークンは期限の少し前まで使い回す。
- PUT は冪等(source_id ごとに1件)なので、通信の失敗と 5xx は間隔を空けて再送する。
  401 はトークンを取り直して1回だけやり直す。404(API にルームがない)は再送しない。
- 保存はバックグラウンドのタスクで行い、字幕の配信や発話の処理を待たせない。
  ジョブの終わり(aclose)に、送り残しをできる範囲で送る。

設定(API_BASE_URL など)が無ければ保存しない。ローカルで API なしでも Agent を動かせる。
"""

import asyncio
import hashlib
import logging
import os
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Any
from urllib.parse import quote

import aiohttp

logger = logging.getLogger(__name__)

# Agent が API を呼ぶときのスコープ(infra/modules/cognito の resource server)
AGENT_SCOPE = "voice-intercom/agent"

# API が受け付ける source_id の形
SOURCE_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

# トークンを期限のこれだけ前に取り直す(秒)
TOKEN_REFRESH_MARGIN_S = 60.0

# 設定が無いことを、プロセスで一度だけログに出すための印
_disabled_logged = False


@dataclass(frozen=True)
class HistorySettings:
    # API の URL(例: https://xxxx.execute-api.ap-northeast-1.amazonaws.com)。末尾の / は無くてよい
    api_base_url: str
    client_id: str
    client_secret: str
    # トークンエンドポイント。空なら issuer の探索(/.well-known/openid-configuration)で得る
    token_url: str | None
    issuer: str | None
    # 原文の確定から、訳がそろうのを待つ上限
    translation_wait_s: float = 30.0
    # PUT を試す回数(初回を含む)と、再送の間隔の基準(1, 2, 4... 倍にしていく)
    max_attempts: int = 4
    retry_base_s: float = 1.0
    # 1回の HTTP の上限
    request_timeout_s: float = 10.0
    # ジョブの終わりに送り残しを送る上限。
    # livekit-agents の shutdown_process_timeout(既定10秒)より短くする
    flush_timeout_s: float = 5.0

    @classmethod
    def from_env(cls) -> HistorySettings | None:
        """設定が足りなければ None(保存しない)。足りないものは一度だけログに出す。"""
        env = {
            name: os.environ.get(name, "").strip()
            for name in ("API_BASE_URL", "AGENT_CLIENT_ID", "AGENT_CLIENT_SECRET")
        }
        token_url = os.environ.get("OIDC_TOKEN_URL", "").strip() or None
        issuer = os.environ.get("OIDC_ISSUER", "").strip() or None
        missing = [name for name, value in env.items() if not value]
        if token_url is None and issuer is None:
            missing.append("OIDC_TOKEN_URL か OIDC_ISSUER")
        if missing:
            _log_disabled(missing, partly_set=any(env.values()))
            return None
        return cls(
            api_base_url=env["API_BASE_URL"].rstrip("/"),
            client_id=env["AGENT_CLIENT_ID"],
            client_secret=env["AGENT_CLIENT_SECRET"],
            token_url=token_url,
            issuer=issuer,
            translation_wait_s=float(
                os.environ.get("HISTORY_TRANSLATION_WAIT_S", cls.translation_wait_s)
            ),
            flush_timeout_s=float(os.environ.get("HISTORY_FLUSH_TIMEOUT_S", cls.flush_timeout_s)),
        )


def _log_disabled(missing: list[str], *, partly_set: bool) -> None:
    global _disabled_logged
    if _disabled_logged:
        return
    _disabled_logged = True
    # 一部だけ設定されているのは設定の誤りの可能性が高いので、警告にする
    log = logger.warning if partly_set else logger.info
    log("履歴の保存と通知は無効(%s が未設定)", "、".join(missing))


def to_source_id(segment_id: str) -> str:
    """segment_id を API の source_id にする。

    今の segment_id(uuid4 の hex、32文字)はそのまま使える。形が合わないものは、同じ値から
    同じ source_id になる(冪等が保たれる)よう、SHA-256 の hex(64文字)にする。
    """
    if SOURCE_ID_PATTERN.fullmatch(segment_id):
        return segment_id
    return hashlib.sha256(segment_id.encode()).hexdigest()


def utc_now() -> datetime:
    return datetime.now(UTC)


def format_time(t: datetime) -> str:
    """ISO 8601、UTC、ミリ秒まで(例: 2026-10-10T00:00:00.000Z)。"""
    return t.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class TokenError(Exception):
    """トークンを取れなかった(トークンエンドポイントや探索の失敗)。"""


class ClientCredentials:
    """client credentials のアクセストークン。期限の少し前まで使い回す。"""

    def __init__(
        self,
        http: aiohttp.ClientSession,
        settings: HistorySettings,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._http = http
        self._settings = settings
        self._clock = clock
        self._token_url = settings.token_url
        self._token: str | None = None
        self._expires_at = 0.0
        # 同時に何本も取りに行かない
        self._lock = asyncio.Lock()

    async def token(self) -> str:
        async with self._lock:
            if self._token is None or self._clock() >= self._expires_at:
                self._token, expires_in = await self._fetch()
                # 期限の少し前に取り直す。期限が短すぎるときは半分で取り直す
                lifetime = max(expires_in - TOKEN_REFRESH_MARGIN_S, expires_in / 2)
                self._expires_at = self._clock() + lifetime
            return self._token

    def invalidate(self, token: str) -> None:
        """API に拒まれた(401)トークンを捨てる。取り直した後なら何もしない。"""
        if self._token == token:
            self._token = None

    async def _fetch(self) -> tuple[str, float]:
        timeout = aiohttp.ClientTimeout(total=self._settings.request_timeout_s)
        token_url = await self._discover(timeout)
        try:
            async with self._http.post(
                token_url,
                data={"grant_type": "client_credentials", "scope": AGENT_SCOPE},
                # Cognito も模擬 OIDC も client_secret_basic を受け付ける
                headers={
                    "Authorization": aiohttp.encode_basic_auth(
                        self._settings.client_id, self._settings.client_secret
                    )
                },
                timeout=timeout,
            ) as res:
                if res.status != 200:
                    raise TokenError(f"トークンを取れなかった({res.status}): {await res.text()}")
                body: dict[str, Any] = await res.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as e:
            raise TokenError(f"トークンを取れなかった: {e!r}") from e
        token = body.get("access_token")
        if not isinstance(token, str) or not token:
            raise TokenError("トークンの応答に access_token がない")
        expires_in = body.get("expires_in")
        return token, float(expires_in) if isinstance(expires_in, int | float) else 3600.0

    async def _discover(self, timeout: aiohttp.ClientTimeout) -> str:
        """トークンエンドポイント。設定に無ければ issuer の探索で得て、覚えておく。"""
        if self._token_url is not None:
            return self._token_url
        url = f"{(self._settings.issuer or '').rstrip('/')}/.well-known/openid-configuration"
        try:
            async with self._http.get(url, timeout=timeout) as res:
                if res.status != 200:
                    raise TokenError(f"OIDC の探索に失敗した({res.status}): {url}")
                body: dict[str, Any] = await res.json(content_type=None)
        except (aiohttp.ClientError, TimeoutError, ValueError) as e:
            raise TokenError(f"OIDC の探索に失敗した: {e!r}") from e
        token_url = body.get("token_endpoint")
        if not isinstance(token_url, str) or not token_url:
            raise TokenError(f"探索の結果に token_endpoint がない: {url}")
        self._token_url = token_url
        return token_url


class PutResult(Enum):
    SAVED = "saved"
    # API にルームがない。再送しない
    NOT_FOUND = "not_found"
    # 400、403 など、やり直しても通らない応答。再送しない
    REJECTED = "rejected"
    # 再送しても通信の失敗か 5xx が続いた
    FAILED = "failed"


class TimelineClient:
    """PUT /rooms/{room_id}/timeline/{source_id} を、再送つきで呼ぶ。"""

    def __init__(
        self,
        http: aiohttp.ClientSession,
        settings: HistorySettings,
        credentials: ClientCredentials,
    ) -> None:
        self._http = http
        self._settings = settings
        self._credentials = credentials

    async def put(self, room_id: str, source_id: str, body: dict[str, Any]) -> PutResult:
        s = self._settings
        url = f"{s.api_base_url}/rooms/{quote(room_id, safe='')}/timeline/{quote(source_id)}"
        timeout = aiohttp.ClientTimeout(total=s.request_timeout_s)
        reauthorized = False
        attempt = 0
        while True:
            attempt += 1
            status: int | None = None
            token = ""
            detail = ""
            try:
                token = await self._credentials.token()
                async with self._http.put(
                    url, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=timeout
                ) as res:
                    status = res.status
                    if 200 <= status < 300:
                        return PutResult.SAVED
                    detail = (await res.text())[:500]
            except (aiohttp.ClientError, TimeoutError, TokenError) as e:
                detail = repr(e)

            if status == 401 and not reauthorized:
                # 期限切れや鍵の入れ替えなど。トークンを取り直して1回だけやり直す(回数に数えない)
                reauthorized = True
                self._credentials.invalidate(token)
                attempt -= 1
                continue
            if status == 404:
                logger.warning("履歴を保存しない(API にルーム %s がない): %s", room_id, source_id)
                return PutResult.NOT_FOUND
            if status is not None and 400 <= status < 500 and status not in (408, 429):
                logger.error("履歴の保存が拒まれた(%d): %s %s", status, source_id, detail)
                return PutResult.REJECTED
            if attempt >= s.max_attempts:
                logger.error(
                    "履歴を保存できなかった(%d回試した。最後は %s): %s %s",
                    attempt,
                    status or "通信の失敗",
                    source_id,
                    detail,
                )
                return PutResult.FAILED
            delay = s.retry_base_s * 2 ** (attempt - 1)
            logger.warning(
                "履歴の保存に失敗した(%s)。%.1f秒後に再送する: %s",
                status or detail,
                delay,
                source_id,
            )
            await asyncio.sleep(delay)


@dataclass
class _Entry:
    """1つの区切り(か1つのテキスト)の、保存を待っている内容。"""

    segment_id: str
    source_id: str
    original: dict[str, Any] | None = None
    targets: frozenset[str] = frozenset()
    translations: dict[str, str] = field(default_factory=dict)
    resolved: set[str] = field(default_factory=set)
    timer: asyncio.TimerHandle | None = None

    def ready(self) -> bool:
        return self.original is not None and self.targets <= self.resolved

    def body(self) -> dict[str, Any]:
        assert self.original is not None
        return {**self.original, "translations": dict(self.translations)}


class HistoryRecorder:
    """ルーム(ジョブ)ごとに1つ。原文と訳の確定を受け取り、そろったら保存する。

    client が None なら何もしない(設定が無いとき)。呼び出しはすべてイベントループの中から。
    """

    def __init__(
        self,
        client: TimelineClient | None,
        room_name: Callable[[], str],
        *,
        translation_wait_s: float = 30.0,
        flush_timeout_s: float = 5.0,
        max_concurrency: int = 4,
    ) -> None:
        self._client = client
        # ルーム名は接続してから決まるので、保存するときに読む
        self._room_name = room_name
        self._translation_wait_s = translation_wait_s
        self._flush_timeout_s = flush_timeout_s
        self._entries: dict[str, _Entry] = {}
        # 保存を始めた segment_id(遅れて届いた訳を無視する)
        self._done: set[str] = set()
        self._tasks: set[asyncio.Task[None]] = set()
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._closed = False

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def original(
        self,
        segment_id: str,
        text: str,
        *,
        sender_id: str,
        language: str | None,
        occurred_at: datetime,
        targets: list[str],
        kind: str = "utterance",
        utterance_id: str | None = None,
        segment_index: int | None = None,
    ) -> None:
        """原文の確定。targets は訳を待つ言語。空の原文は保存しない。"""
        if not self._accepts(segment_id):
            return
        if not text.strip():
            self._finish(segment_id)
            return
        entry = self._entry(segment_id)
        entry.original = {
            "kind": kind,
            "sender_id": sender_id,
            "occurred_at": format_time(occurred_at),
            "language": language,
            "text": text,
        }
        if kind == "utterance":
            entry.original["utterance_id"] = utterance_id
            entry.original["segment_index"] = segment_index
        entry.targets = frozenset(targets)
        if entry.ready():
            self._send(entry)
        else:
            loop = asyncio.get_running_loop()
            entry.timer = loop.call_later(self._translation_wait_s, self._expire, segment_id)

    def translation(self, segment_id: str, language: str, text: str | None) -> None:
        """訳の確定。失敗や打ち切りで訳が無いときは text を None(か空)にする。"""
        if not self._accepts(segment_id):
            return
        entry = self._entry(segment_id)
        entry.resolved.add(language)
        if text and text.strip():
            entry.translations[language] = text
        if entry.ready():
            self._send(entry)

    async def aclose(self) -> None:
        """送り残しを送る。訳がそろっていない区切りは、そろった分だけで送る。"""
        if self._closed:
            return
        self._closed = True
        for entry in list(self._entries.values()):
            if entry.original is not None:
                self._send(entry, reason="ジョブの終わり")
        # 原文が確定していないもの(訳だけが届いたもの)は保存しない
        self._entries.clear()
        if not self._tasks:
            return
        _, pending = await asyncio.wait(self._tasks, timeout=self._flush_timeout_s)
        if pending:
            logger.warning("ジョブの終わりまでに送れなかった履歴を捨てた: %d件", len(pending))
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

    def _accepts(self, segment_id: str) -> bool:
        return self._client is not None and not self._closed and segment_id not in self._done

    def _entry(self, segment_id: str) -> _Entry:
        entry = self._entries.get(segment_id)
        if entry is None:
            entry = self._entries[segment_id] = _Entry(segment_id, to_source_id(segment_id))
        return entry

    def _finish(self, segment_id: str) -> _Entry | None:
        self._done.add(segment_id)
        entry = self._entries.pop(segment_id, None)
        if entry is not None and entry.timer is not None:
            entry.timer.cancel()
        return entry

    def _expire(self, segment_id: str) -> None:
        entry = self._entries.get(segment_id)
        if entry is not None:
            self._send(entry, reason=f"{self._translation_wait_s:.0f}秒たった")

    def _send(self, entry: _Entry, *, reason: str | None = None) -> None:
        self._finish(entry.segment_id)
        missing = entry.targets - entry.resolved
        if missing and reason:
            logger.warning(
                "訳がそろわないまま履歴に保存する(%s。%s が無い): %s",
                reason,
                ",".join(sorted(missing)),
                entry.source_id,
            )
        task = asyncio.create_task(self._put(entry.source_id, entry.body()))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _put(self, source_id: str, body: dict[str, Any]) -> None:
        assert self._client is not None
        async with self._semaphore:
            try:
                result = await self._client.put(self._room_name(), source_id, body)
            except Exception:
                logger.exception("履歴の保存で予期しない失敗: %s", source_id)
                return
        if result is PutResult.SAVED:
            logger.debug("履歴に保存した: %s", source_id)


@dataclass(frozen=True)
class ApiAccess:
    """API を呼ぶための設定とトークン。履歴の保存と通知(notify.py)で共有する。"""

    settings: HistorySettings
    credentials: ClientCredentials


def create_api_access(http: aiohttp.ClientSession) -> ApiAccess | None:
    """環境変数の設定で ApiAccess を作る。設定が無ければ None(API を呼ばない)。"""
    settings = HistorySettings.from_env()
    if settings is None:
        return None
    return ApiAccess(settings, ClientCredentials(http, settings))


def create_history(
    http: aiohttp.ClientSession, room_name: Callable[[], str], api: ApiAccess | None
) -> HistoryRecorder:
    """HistoryRecorder を作る。api が None(設定が無い)なら何もしないものを返す。"""
    if api is None:
        return HistoryRecorder(None, room_name)
    settings = api.settings
    client = TimelineClient(http, settings, api.credentials)
    return HistoryRecorder(
        client,
        room_name,
        translation_wait_s=settings.translation_wait_s,
        flush_timeout_s=settings.flush_timeout_s,
    )
