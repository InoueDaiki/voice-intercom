import threading
import time
from collections.abc import Iterable, Iterator, Mapping
from typing import Any

import boto3
import pytest
from timeline_env import (
    AGENT_SCOPE,
    TIMELINE_TABLE,
    Token,
    belong,
    call,
    setup_timeline,
    teardown_timeline,
)

from voice_intercom_api import notifications, notify, room_push, store, timeline_store
from voice_intercom_api.device_store import Device
from voice_intercom_api.notify import SendResult

PATH = "/rooms/room-n/notifications/speaking"


class FakeNotify:
    """notify.send_to_users の代わり。送った相手と文面を記録する。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.error: Exception | None = None
        self._lock = threading.Lock()

    def send_to_users(
        self,
        user_ids: Iterable[str],
        *,
        title: str,
        body: str,
        data: Mapping[str, str] | None = None,
        progress: notify.SendProgress | None = None,
    ) -> SendResult:
        if self.error is not None:
            raise self.error
        ids = list(user_ids)
        with self._lock:
            self.calls.append({"user_ids": ids, "title": title, "body": body, "data": data})
        return SendResult(sent=len(ids))

    @property
    def recipients(self) -> list[str]:
        return [uid for c in self.calls for uid in c["user_ids"]]


@pytest.fixture(autouse=True)
def timeline(tables: None, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    setup_timeline(monkeypatch)
    monkeypatch.delenv("NOTIFY_INTERVAL_S", raising=False)
    store.create_room(
        "room-n", "現場A", ["speaker", "present-1", "away-1", "away-2"], tenant_id="t1"
    )
    store.put_user("speaker", display_name="太郎", language="ja")
    for user_id in ("speaker", "present-1", "away-1", "away-2"):
        belong(user_id, "t1")
    yield
    teardown_timeline()


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeNotify:
    fake = FakeNotify()
    monkeypatch.setattr(notify, "send_to_users", fake.send_to_users)
    # サービスアカウントは設定済みとみなす
    monkeypatch.setattr(notify, "service_account", lambda: None)
    return fake


@pytest.fixture
def agent(make_token: Token) -> str:
    return make_token(sub="agent-client", scope=AGENT_SCOPE, **{"cognito:groups": None})


def speak(token: str, speaker: str = "speaker", present: list[str] | None = None) -> Any:
    body = {"speaker_id": speaker, "present_ids": ["present-1"] if present is None else present}
    return call("POST", PATH, token, body)


def timeline_table() -> Any:
    return boto3.resource("dynamodb").Table(TIMELINE_TABLE)  # pyright: ignore[reportAttributeAccessIssue]


def set_sent_at(recipient: str, epoch: int) -> None:
    timeline_table().put_item(
        Item={
            "room_id": "notify#room-n",
            "event_id": recipient,
            "sent_at_epoch": epoch,
        }
    )


def test_sends_to_members_not_present(agent: str, fake: FakeNotify) -> None:
    status, body = speak(agent)

    assert status == 200
    assert body == {"sent": 2, "skipped": 0}
    assert len(fake.calls) == 1
    assert fake.calls[0] == {
        "user_ids": ["away-1", "away-2"],
        "title": "現場A",
        "body": "太郎さんが話しています",
        "data": {"type": "speaking", "room_id": "room-n"},
    }


def test_moved_member_gets_no_speaking_push(agent: str, fake: FakeNotify) -> None:
    # 所属を変えた途中でメンバーの行が残っていても、元のルームの通知は届かない
    belong("away-1", "t2")

    speak(agent)

    assert fake.recipients == ["away-2"]


def test_moved_member_gets_no_text_push(agent: str, fake: FakeNotify) -> None:
    belong("away-2", "t2")

    call(
        "POST",
        "/rooms/room-n/notifications/text",
        agent,
        {"sender_id": "speaker", "present_ids": ["present-1"], "text": "秘密の話"},
    )

    assert fake.recipients == ["away-1"]


def test_member_without_tenant_gets_no_push(agent: str, fake: FakeNotify) -> None:
    # 所属を外した人(users の行に tenant_id が無い)
    store.put_user("away-1", display_name="次郎", language="ja")
    store._users().update_item(  # pyright: ignore[reportPrivateUsage]
        Key={"user_id": "away-1"}, UpdateExpression="REMOVE tenant_id"
    )

    speak(agent)

    assert fake.recipients == ["away-2"]


def test_unknown_speaker_is_someone(agent: str, fake: FakeNotify) -> None:
    status, body = speak(agent, speaker="no-profile", present=[])

    assert status == 200
    # 話者が member_ids にいなくても、メンバー全員に送る
    assert body == {"sent": 4, "skipped": 0}
    assert fake.calls[0]["body"] == "誰かが話しています"


def test_nobody_to_send(agent: str, fake: FakeNotify) -> None:
    status, body = speak(agent, present=["present-1", "away-1", "away-2"])

    assert status == 200
    assert body == {"sent": 0, "skipped": 0}
    assert fake.calls == []


def test_inside_interval_is_skipped(agent: str, fake: FakeNotify) -> None:
    assert speak(agent)[1] == {"sent": 2, "skipped": 0}

    # 2回目は間隔の内側。今度は present-1 が抜けたので、present-1 にだけ送る
    status, body = speak(agent, present=[])

    assert status == 200
    assert body == {"sent": 1, "skipped": 2}
    assert fake.calls[1]["user_ids"] == ["present-1"]


def test_outside_interval_sends_again(agent: str, fake: FakeNotify) -> None:
    now = int(time.time())
    set_sent_at("away-1", now - room_push.DEFAULT_INTERVAL_S - 1)
    set_sent_at("away-2", now - 10)

    status, body = speak(agent)

    assert status == 200
    assert body == {"sent": 1, "skipped": 1}
    assert fake.recipients == ["away-1"]


def test_interval_from_env(agent: str, fake: FakeNotify, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOTIFY_INTERVAL_S", "5")
    set_sent_at("away-1", int(time.time()) - 6)
    set_sent_at("away-2", int(time.time()) - 1)

    assert speak(agent)[1] == {"sent": 1, "skipped": 1}


def test_claim_sets_ttl(agent: str, fake: FakeNotify) -> None:
    speak(agent)

    item = timeline_table().get_item(Key={"room_id": "notify#room-n", "event_id": "away-1"})["Item"]
    assert item["expires_at_epoch"] > item["sent_at_epoch"] + room_push.DEFAULT_INTERVAL_S
    # 履歴には出てこない
    assert timeline_store.list_events("room-n", limit=10, before=None) == ([], None)


def test_concurrent_calls_send_once(agent: str, fake: FakeNotify) -> None:
    results: list[Any] = []
    barrier = threading.Barrier(2)

    def run() -> None:
        barrier.wait()
        results.append(speak(agent))

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(r[1]["sent"] for r in results) == [0, 2]
    assert sorted(fake.recipients) == ["away-1", "away-2"]


def test_room_not_found(agent: str, fake: FakeNotify) -> None:
    status, _ = call("POST", "/rooms/nope/notifications/speaking", agent, {"speaker_id": "speaker"})

    assert status == 404


@pytest.mark.parametrize("groups", [["admin"], []])
def test_users_are_forbidden(make_token: Token, fake: FakeNotify, groups: list[str]) -> None:
    status, _ = speak(make_token(sub="speaker", **{"cognito:groups": groups}))

    assert status == 403
    assert fake.calls == []


def test_send_error_is_not_500(agent: str, fake: FakeNotify) -> None:
    fake.error = RuntimeError("FCM のアクセストークンを作れなかった")

    status, body = speak(agent)

    assert status == 200
    assert body == {"sent": 0, "skipped": 0}

    # 送れなかったときは時刻を戻すので、次の呼び出しで送れる
    fake.error = None
    assert speak(agent)[1] == {"sent": 2, "skipped": 0}


def test_not_configured_is_not_500(agent: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FCM_SERVICE_ACCOUNT", raising=False)
    monkeypatch.delenv("FCM_SERVICE_ACCOUNT_PARAMETER", raising=False)
    notify.service_account.cache_clear()
    try:
        status, body = speak(agent)
    finally:
        notify.service_account.cache_clear()

    assert status == 200
    assert body == {"sent": 0, "skipped": 0}


def test_broken_service_account_is_not_500(agent: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # 中身がサービスアカウントの JSON でない
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT", "not json")
    notify.service_account.cache_clear()
    try:
        status, body = speak(agent)
    finally:
        notify.service_account.cache_clear()

    assert status == 200
    assert body == {"sent": 0, "skipped": 0}


def test_missing_parameter_is_not_500(agent: str, monkeypatch: pytest.MonkeyPatch) -> None:
    # SSM にパラメーターをまだ入れていない
    monkeypatch.delenv("FCM_SERVICE_ACCOUNT", raising=False)
    monkeypatch.setenv("FCM_SERVICE_ACCOUNT_PARAMETER", "/voice-intercom-test/fcm/missing")
    notify.service_account.cache_clear()
    try:
        status, body = speak(agent)
    finally:
        notify.service_account.cache_clear()

    assert status == 200
    assert body == {"sent": 0, "skipped": 0}


def test_slow_send_returns_in_time(
    agent: str, fake: FakeNotify, monkeypatch: pytest.MonkeyPatch
) -> None:
    release = threading.Event()

    def slow(user_ids: Iterable[str], **_kwargs: Any) -> SendResult:
        release.wait(5)
        return SendResult()

    monkeypatch.setattr(notify, "send_to_users", slow)
    monkeypatch.setattr(notifications, "SEND_TIMEOUT_S", 0.1)
    try:
        status, body = speak(agent)
    finally:
        release.set()

    assert status == 200
    # 待ちきれなかった送信は打ち切るので数えず、時刻を戻す
    assert body == {"sent": 0, "skipped": 0}
    monkeypatch.setattr(notify, "send_to_users", fake.send_to_users)
    assert speak(agent)[1] == {"sent": 2, "skipped": 0}
    assert fake.recipients == ["away-1", "away-2"]


def test_timeout_keeps_interval_of_done_recipients(
    agent: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    release = threading.Event()

    def partial(
        user_ids: Iterable[str], *, progress: notify.SendProgress | None = None, **_kwargs: Any
    ) -> SendResult:
        # away-1 には送り終え、away-2 に送っている途中で止まる
        assert progress is not None
        progress.start(user_ids, [Device("away-1", "t1", "ios"), Device("away-2", "t2", "ios")])
        progress.finish(Device("away-1", "t1", "ios"))
        release.wait(5)
        return SendResult()

    monkeypatch.setattr(notify, "send_to_users", partial)
    monkeypatch.setattr(notify, "service_account", lambda: None)
    monkeypatch.setattr(notifications, "SEND_TIMEOUT_S", 0.1)
    try:
        assert speak(agent)[1] == {"sent": 1, "skipped": 0}
    finally:
        release.set()

    # 送り終えなかった away-2 だけ、次の通知で送る
    fake = FakeNotify()
    monkeypatch.setattr(notify, "send_to_users", fake.send_to_users)
    assert speak(agent)[1] == {"sent": 1, "skipped": 1}
    assert fake.recipients == ["away-2"]


# テキスト入力の通知

TEXT_PATH = "/rooms/room-n/notifications/text"


def text(
    token: str, sender: str = "speaker", body: str = "こんにちは", present: list[str] | None = None
) -> Any:
    payload = {
        "sender_id": sender,
        "present_ids": ["present-1"] if present is None else present,
        "text": body,
    }
    return call("POST", TEXT_PATH, token, payload)


def test_text_sends_head_of_text(agent: str, fake: FakeNotify) -> None:
    status, body = text(agent, body="資材が\n届きました")

    assert status == 200
    assert body == {"sent": 2, "skipped": 0}
    assert fake.calls == [
        {
            "user_ids": ["away-1", "away-2"],
            "title": "現場A",
            "body": "太郎さん: 資材が 届きました",
            "data": {"type": "text", "room_id": "room-n"},
        }
    ]


def test_text_body_shortens_and_unknown_sender(agent: str, fake: FakeNotify) -> None:
    text(agent, sender="no-profile", body="あ" * 60, present=[])

    assert fake.calls[0]["body"] == "誰か: " + "あ" * 50 + "…"
    # 送信者が member_ids にいなくても、メンバー全員に送る(メンバーは user_id の順)
    assert fake.calls[0]["user_ids"] == ["away-1", "away-2", "present-1", "speaker"]


def test_text_excludes_sender_and_present(agent: str, fake: FakeNotify) -> None:
    status, body = text(agent, present=["present-1", "away-1", "away-2"])

    assert status == 200
    assert body == {"sent": 0, "skipped": 0}
    assert fake.calls == []


def test_text_room_not_found(agent: str, fake: FakeNotify) -> None:
    status, _ = call(
        "POST", "/rooms/nope/notifications/text", agent, {"sender_id": "speaker", "text": "a"}
    )

    assert status == 404


def test_text_users_are_forbidden(make_token: Token, fake: FakeNotify) -> None:
    status, _ = text(make_token(sub="speaker", **{"cognito:groups": []}))

    assert status == 403
    assert fake.calls == []


def test_empty_text_is_rejected(agent: str, fake: FakeNotify) -> None:
    status, _ = text(agent, body="")

    assert status == 422
    assert fake.calls == []


def test_kinds_share_the_interval(agent: str, fake: FakeNotify) -> None:
    # 話し始めの後のテキストは、同じ受け手には間隔の内側なので送らない
    assert speak(agent)[1] == {"sent": 2, "skipped": 0}

    assert text(agent)[1] == {"sent": 0, "skipped": 2}
    assert len(fake.calls) == 1


def test_other_room_is_counted_separately(agent: str, fake: FakeNotify) -> None:
    store.create_room("room-o", "現場B", ["speaker", "away-1"], tenant_id="t1")
    assert speak(agent)[1] == {"sent": 2, "skipped": 0}

    status, body = call(
        "POST",
        "/rooms/room-o/notifications/text",
        agent,
        {"sender_id": "speaker", "text": "別のルーム"},
    )

    assert status == 200
    assert body == {"sent": 1, "skipped": 0}
    assert fake.calls[1]["user_ids"] == ["away-1"]
