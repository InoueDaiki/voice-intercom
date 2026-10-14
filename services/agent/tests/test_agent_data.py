"""テキスト入力のデータパケットの受け付け(agent.py の IntercomAgent._on_data_received)。"""

import logging
from types import SimpleNamespace
from typing import Any

import pytest
from livekit import rtc

from voice_intercom_agent.agent import IntercomAgent
from voice_intercom_agent.text_input import TEXT_TOPIC


class FakeDeps:
    def __init__(self) -> None:
        self.spawned: list[Any] = []

    def spawn(self, coro: Any) -> None:
        self.spawned.append(coro)
        coro.close()


def receive(packet: Any) -> FakeDeps:
    deps = FakeDeps()
    # ルームやセッションは使わない経路だけを確かめるので、必要な属性だけを持つ代わりの self で呼ぶ
    agent = SimpleNamespace(_deps=deps)
    IntercomAgent._on_data_received(agent, packet)  # pyright: ignore[reportArgumentType]
    return deps


def test_text_without_known_sender_is_dropped_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # 入室の直後に送られたテキストは、参加者の情報より先に届き、participant が None になる
    # (ローカルの LiveKit で再現した)。黙って捨てずにログに残す
    packet = SimpleNamespace(topic=TEXT_TOPIC, participant=None, data=b"")
    with caplog.at_level(logging.WARNING):
        deps = receive(packet)
    assert deps.spawned == []
    assert "送信元が分からないテキストを捨てた" in caplog.text


def test_other_topics_are_ignored_silently(caplog: pytest.LogCaptureFixture) -> None:
    packet = SimpleNamespace(topic="caption", participant=None, data=b"")
    with caplog.at_level(logging.WARNING):
        deps = receive(packet)
    assert deps.spawned == []
    assert caplog.text == ""


class FakeNotifier:
    def __init__(self) -> None:
        self.texts: list[tuple[str, list[str], str]] = []

    def text(self, sender_id: str, present: list[str], text: str) -> None:
        self.texts.append((sender_id, present, text))


def test_accepted_text_asks_for_push_with_present_people() -> None:
    standard = rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD
    participants = {
        "a": SimpleNamespace(identity="alice", kind=standard),
        "b": SimpleNamespace(identity="bob", kind=standard),
        "x": SimpleNamespace(identity="agent-1", kind=rtc.ParticipantKind.PARTICIPANT_KIND_AGENT),
    }
    notifier = FakeNotifier()
    agent = SimpleNamespace(
        _room=SimpleNamespace(remote_participants=participants),
        _deps=SimpleNamespace(notifier=notifier),
    )
    IntercomAgent._text_accepted(agent, "alice", "はい")  # pyright: ignore[reportArgumentType]
    # Agent は今ルームにいる人に数えない。送信者は API 側で除く
    assert notifier.texts == [("alice", ["alice", "bob"], "はい")]
