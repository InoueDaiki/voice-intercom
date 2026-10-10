"""テキスト入力のデータパケットの受け付け(agent.py の IntercomAgent._on_data_received)。"""

import logging
from types import SimpleNamespace
from typing import Any

import pytest

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
