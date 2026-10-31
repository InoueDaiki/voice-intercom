"""FCM HTTP v1 で push 通知を送る。

    from voice_intercom_api import notify
    notify.send_to_users(["user-1", "user-2"], title="...", body="...", data={"room_id": "..."})

- 端末トークンは users テーブルから取る(device_store.py)。
- サービスアカウントの JSON は、AWS では SSM の SecureString(環境変数
  FCM_SERVICE_ACCOUNT_PARAMETER にパラメーター名)から、ローカルでは環境変数 FCM_SERVICE_ACCOUNT
  (JSON そのもの)から読む。LiveKit の API シークレットと同じ流儀。どちらもなければ送らない
  (ローカルで FCM なしに API を動かせるように)。
  パラメーターは Terraform では作らず、手で入れる(README の「秘密情報」)。
  まだ入れていないと、get_parameter が ParameterNotFound(ClientError)を投げる。呼び出し側は
  ほかの読めないときと同じくログに残して送らない。例外は cache に残らないので、入れた後の呼び出し
  から送れる。
- OAuth2 のアクセストークンは、サービスアカウントの鍵で署名した JWT を Google のトークン
  エンドポイントで交換して作り、期限の少し前まで使い回す(ウォームスタートの間)。google-auth は
  依存(requests、pyasn1 など)が増えて Lambda のパッケージが大きくなるので使わず、
  既にある PyJWT と標準ライブラリの urllib で済ませる。
- Android は高優先度、iOS は通常の alert 通知(apns-push-type: alert)で送る(docs/設計メモ.md の
  「通知とバックグラウンド音声」)。サイレント通知は使わない。
- FCM が UNREGISTERED か、トークンが原因の INVALID_ARGUMENT を返したトークンは users から消す。
- 送れなかったトークン(5xx、429 など)はやり直さず、結果に数えるだけにする。通知は届かなくても
  履歴には残るので、Lambda の中で待たない。
- send_to_users_within は送信を timeout_s 秒で打ち切る。Lambda は応答を返すと実行環境を止める
  ので、待ちきれなかった送信が後から続く当てはない(次に起きたときに古い通知として届くことも
  ある)。打ち切ったら、まだ始めていない送信(トークンの取得を含む)はしない。送り終えた受け手を
  返し、呼び出し側(room_push.py)は残りの受け手の間引きの時刻を戻す。
"""

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import cache
from typing import Any

import boto3
import jwt

from voice_intercom_api import device_store
from voice_intercom_api.device_store import Device

logger = logging.getLogger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"
_SEND_URL = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"

# アクセストークンの有効期間(Google の上限は1時間)と、期限のどれだけ前に作り直すか
_ASSERTION_TTL = 3600
_REFRESH_MARGIN = 300

# 1回の HTTP の待ち時間(秒)。API の Lambda の timeout(15秒)に収める
_HTTP_TIMEOUT = 5
# 同時に送る数。FCM HTTP v1 は1リクエストに1トークンなので、並べて送る
_MAX_WORKERS = 8


@dataclass(frozen=True)
class ServiceAccount:
    project_id: str
    client_email: str
    private_key: str
    private_key_id: str
    token_uri: str


@dataclass(frozen=True)
class SendResult:
    sent: int = 0
    # 送れなかった(消したものを含まない)
    failed: int = 0
    # 不正なトークンとして users から消した
    removed: int = 0


class NotConfiguredError(Exception):
    pass


class SendProgress:
    """send_to_users の進み具合。送信を打ち切る印と、送り終えた受け手を持つ。

    送信のスレッドと、待つ側のスレッドの両方から触るので、ロックで守る。
    受け手は、登録した端末のすべてに送り終えたら(成功・失敗を問わず)「送り終えた」とする。
    端末を登録していない受け手は、端末を引いた時点で送り終えたとする。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cancelled = threading.Event()
        self._pending: dict[str, int] = {}
        self._done: set[str] = set()

    def cancel(self) -> None:
        """まだ始めていない送信をしないようにする。"""
        self._cancelled.set()

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    def start(self, user_ids: Iterable[str], devices: Iterable[Device]) -> None:
        """送る端末が決まったときに呼ぶ。"""
        with self._lock:
            for uid in user_ids:
                self._pending.setdefault(uid, 0)
            for d in devices:
                self._pending[d.user_id] = self._pending.get(d.user_id, 0) + 1
            for uid, n in self._pending.items():
                if n == 0:
                    self._done.add(uid)

    def finish(self, device: Device) -> None:
        """端末1つに送り終えたときに呼ぶ。"""
        with self._lock:
            n = self._pending.get(device.user_id, 0) - 1
            self._pending[device.user_id] = n
            if n <= 0:
                self._done.add(device.user_id)

    def done(self) -> set[str]:
        """送り終えた受け手。"""
        with self._lock:
            return set(self._done)


@cache
def service_account() -> ServiceAccount:
    """サービスアカウントの JSON を読む。コールドスタートのときに1回だけ読む。"""
    raw = os.environ.get("FCM_SERVICE_ACCOUNT")
    if not raw:
        name = os.environ.get("FCM_SERVICE_ACCOUNT_PARAMETER")
        if not name:
            raise NotConfiguredError("FCM_SERVICE_ACCOUNT も FCM_SERVICE_ACCOUNT_PARAMETER もない")
        res = boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)
        raw = res["Parameter"]["Value"]
    try:
        info = json.loads(raw)
        return ServiceAccount(
            project_id=info["project_id"],
            client_email=info["client_email"],
            private_key=info["private_key"],
            private_key_id=info.get("private_key_id", ""),
            token_uri=info.get("token_uri") or _DEFAULT_TOKEN_URI,
        )
    except (ValueError, KeyError, TypeError) as e:
        # 中身がサービスアカウントの JSON でないとき。パラメーターが無いときはここに来ない
        # (get_parameter が ParameterNotFound を投げる)
        raise RuntimeError("FCM のサービスアカウントの JSON が読めない") from e


def _post(url: str, *, data: bytes, headers: Mapping[str, str]) -> tuple[int, dict[str, Any]]:
    """POST して、HTTP の状態コードと JSON の本文を返す。テストではこれを差し替える。"""
    req = urllib.request.Request(url, data=data, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as res:  # noqa: S310
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        body = json.loads(raw) if raw else {}
    except ValueError:
        body = {}
    return status, body if isinstance(body, dict) else {}


class _AccessTokenCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token = ""
        self._expires_at = 0.0

    def get(self) -> str:
        with self._lock:
            if not self._token or time.time() >= self._expires_at - _REFRESH_MARGIN:
                self._token, self._expires_at = _fetch_access_token(service_account())
            return self._token

    def clear(self) -> None:
        with self._lock:
            self._token, self._expires_at = "", 0.0


def _fetch_access_token(sa: ServiceAccount) -> tuple[str, float]:
    """サービスアカウントの JWT をアクセストークンに交換する(RFC 7523 の jwt-bearer)。"""
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": sa.client_email,
            "scope": FCM_SCOPE,
            "aud": sa.token_uri,
            "iat": now,
            "exp": now + _ASSERTION_TTL,
        },
        sa.private_key,
        algorithm="RS256",
        headers={"kid": sa.private_key_id} if sa.private_key_id else None,
    )
    status, body = _post(
        sa.token_uri,
        data=urllib.parse.urlencode(
            {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}
        ).encode(),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    if status != 200 or "access_token" not in body:
        raise RuntimeError(f"FCM のアクセストークンを作れなかった: {status} {body.get('error')}")
    return body["access_token"], now + float(body.get("expires_in", _ASSERTION_TTL))


_access_token = _AccessTokenCache()


def access_token() -> str:
    return _access_token.get()


def build_message(
    device: Device, *, title: str, body: str, data: Mapping[str, str]
) -> dict[str, Any]:
    """FCM HTTP v1 の message。端末の OS ごとに優先度を分ける。"""
    message: dict[str, Any] = {
        "token": device.token,
        "notification": {"title": title, "body": body},
    }
    if data:
        # data の値は文字列だけ
        message["data"] = {str(k): str(v) for k, v in data.items()}
    if device.platform == "android":
        message["android"] = {"priority": "HIGH"}
    else:
        # 通常の alert 通知。apns-priority 10 は「すぐ届ける」で、alert の既定
        message["apns"] = {
            "headers": {"apns-push-type": "alert", "apns-priority": "10"},
            "payload": {"aps": {"sound": "default"}},
        }
    return {"message": message}


def is_invalid_token(status: int, body: Mapping[str, Any]) -> bool:
    """FCM の応答が「このトークンはもう使えない」かどうか。

    INVALID_ARGUMENT は本文の不備でも返るので、トークンが原因と分かるときだけにする
    (送る側のバグで全員のトークンを消さないため)。
    """
    error = body.get("error")
    if not isinstance(error, dict):
        return False
    details = [d for d in error.get("details", []) if isinstance(d, dict)]
    codes = {d.get("errorCode") for d in details}
    if "UNREGISTERED" in codes:
        return True
    if "INVALID_ARGUMENT" not in codes and error.get("status") != "INVALID_ARGUMENT":
        return False
    for d in details:
        for violation in d.get("fieldViolations", []):
            if isinstance(violation, dict) and violation.get("field") == "message.token":
                return True
    return "registration token" in str(error.get("message", "")).lower()


@dataclass(frozen=True)
class _Outcome:
    device: Device
    status: int
    body: dict[str, Any]


# 打ち切ったので送らなかった(_Outcome.status に入れる)
_SKIPPED = -1


def _send_one(
    device: Device,
    payload: dict[str, Any],
    token: str,
    url: str,
    progress: SendProgress | None,
    *,
    last: bool,
) -> _Outcome:
    """端末1つに送る。last は、401 でも送り直さない(この結果で終わりにする)とき。"""
    if progress is not None and progress.cancelled:
        return _Outcome(device, _SKIPPED, {})
    outcome = _post_one(device, payload, token, url)
    if progress is not None and (last or outcome.status != 401):
        progress.finish(device)
    return outcome


def _post_one(device: Device, payload: dict[str, Any], token: str, url: str) -> _Outcome:
    try:
        status, res = _post(
            url,
            data=json.dumps(payload).encode(),
            headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        )
    except OSError as e:
        # タイムアウトや接続の失敗
        logger.warning("FCM に送れなかった: %s", e)
        return _Outcome(device, 0, {})
    return _Outcome(device, status, res)


def _send_all(
    devices: list[Device],
    payloads: list[dict[str, Any]],
    url: str,
    progress: SendProgress | None,
    *,
    last: bool,
) -> list[_Outcome]:
    if progress is not None and progress.cancelled:
        return [_Outcome(d, _SKIPPED, {}) for d in devices]
    token = access_token()
    with ThreadPoolExecutor(max_workers=min(_MAX_WORKERS, len(devices))) as pool:
        return list(
            pool.map(
                lambda d, p: _send_one(d, p, token, url, progress, last=last), devices, payloads
            )
        )


def send_to_devices(
    devices: list[Device],
    *,
    title: str,
    body: str,
    data: Mapping[str, str] | None = None,
    progress: SendProgress | None = None,
) -> SendResult:
    """progress を渡すと、打ち切られたら残りを送らず、送り終えた端末を知らせる。"""
    if not devices:
        return SendResult()
    url = _SEND_URL.format(project_id=service_account().project_id)
    payloads = [build_message(d, title=title, body=body, data=data or {}) for d in devices]
    outcomes = _send_all(devices, payloads, url, progress, last=False)

    # アクセストークンが取り消された・期限が切れたときは、作り直して1回だけ送り直す
    retry = [i for i, o in enumerate(outcomes) if o.status == 401]
    if retry:
        _access_token.clear()
        again = _send_all(
            [devices[i] for i in retry], [payloads[i] for i in retry], url, progress, last=True
        )
        for i, o in zip(retry, again, strict=True):
            outcomes[i] = o

    sent = failed = 0
    invalid: dict[str, list[str]] = {}
    for o in outcomes:
        if o.status == 200:
            sent += 1
        elif o.status == _SKIPPED:
            failed += 1
        elif is_invalid_token(o.status, o.body):
            invalid.setdefault(o.device.user_id, []).append(device_store.token_key(o.device.token))
        else:
            failed += 1
            error = o.body.get("error", {})
            logger.warning(
                "FCM の送信に失敗した: user=%s status=%s error=%s",
                o.device.user_id,
                o.status,
                error.get("status") if isinstance(error, dict) else None,
            )
    for user_id, keys in invalid.items():
        device_store.remove(user_id, keys)
    removed = sum(len(keys) for keys in invalid.values())
    return SendResult(sent=sent, failed=failed, removed=removed)


def send_to_users(
    user_ids: Iterable[str],
    *,
    title: str,
    body: str,
    data: Mapping[str, str] | None = None,
    progress: SendProgress | None = None,
) -> SendResult:
    """複数の人の、登録済みのすべての端末に通知を送る。

    送り主を除くなど、だれに送るかは呼び出し側で決める。FCM が設定されていなければ何もしない。
    progress は send_to_devices と同じ。
    """
    try:
        service_account()
    except NotConfiguredError:
        logger.info("FCM が設定されていないので、通知を送らない")
        return SendResult()
    ids = list(user_ids)
    devices = device_store.list_devices(ids)
    if progress is not None:
        progress.start(ids, devices)
    return send_to_devices(devices, title=title, body=body, data=data, progress=progress)


def send_to_users_within(
    user_ids: list[str],
    *,
    title: str,
    body: str,
    data: Mapping[str, str],
    timeout_s: float,
    label: str,
) -> set[str]:
    """send_to_users を別のスレッドで動かし、timeout_s 秒まで待つ。送り終えた受け手を返す。

    API の Lambda の timeout(15秒)に収めるために使う。label はログに出す通知の名前。
    - 待つ間に終われば、user_ids のすべて(端末を登録していない人、FCM が失敗した人も含む)。
    - 例外で失敗したら、それまでに送り終えた受け手。
    - 待ちきれなかったら、送信を打ち切り(まだ始めていない送信はしない)、それまでに送り終えた
      受け手。Lambda は応答を返すと実行環境を止めるので、残りの送信が続くとは見なさない。
      打ち切った時点で送っている最中の端末には、後から届くことがある(その受け手は返さない)。
    """
    error: list[BaseException] = []
    progress = SendProgress()

    def run() -> None:
        try:
            result = send_to_users(user_ids, title=title, body=body, data=data, progress=progress)
            logger.info(
                "%sの通知を送った: sent=%d failed=%d removed=%d",
                label,
                result.sent,
                result.failed,
                result.removed,
            )
        except Exception as e:
            logger.exception("%sの通知を送れなかった", label)
            error.append(e)

    # daemon にして、待ちきれなかったスレッドが応答を止めないようにする
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout_s)
    if thread.is_alive():
        progress.cancel()
        done = progress.done()
        logger.warning(
            "%sの通知の送信を待ちきれず、打ち切った(%s 秒): done=%d rest=%d",
            label,
            timeout_s,
            len(done),
            len(set(user_ids) - done),
        )
        return done
    if error:
        return progress.done()
    return set(user_ids)
