"""WhisperSession の区切りの扱い(commit と書き起こしのイベントの対応)。通信はしない。"""

import asyncio
from typing import Any, cast

from voice_intercom_agent.realtime import WhisperSession


class FakeWs:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, data: dict[str, Any]) -> None:
        self.sent.append(data)


class Recorder:
    def __init__(self) -> None:
        self.deltas: list[tuple[int, str]] = []
        self.completed: list[tuple[int, str]] = []

    def session(self) -> WhisperSession:
        return WhisperSession(
            cast(Any, None),
            "key",
            model="gpt-realtime-whisper",
            language="ja",
            commit_timeout_s=10,
            on_delta=lambda i, t: self.deltas.append((i, t)),
            on_completed=lambda i, t: self.completed.append((i, t)),
        )


def append(session: WhisperSession) -> None:
    # 送信のタスクが音声を送った後と同じ状態にする
    session._on_append()  # pyright: ignore[reportPrivateUsage]


def split(session: WhisperSession, ws: FakeWs) -> None:
    asyncio.run(session._send_split(cast(Any, ws)))  # pyright: ignore[reportPrivateUsage]


def end(session: WhisperSession, ws: FakeWs) -> None:
    session.finish()
    asyncio.run(session._send_end(cast(Any, ws)))  # pyright: ignore[reportPrivateUsage]


def handle(session: WhisperSession, ev: dict[str, Any]) -> bool:
    return session._handle(ev)  # pyright: ignore[reportPrivateUsage]


def delta(item_id: str, text: str) -> dict[str, Any]:
    return {
        "type": "conversation.item.input_audio_transcription.delta",
        "item_id": item_id,
        "delta": text,
    }


def completed(item_id: str, text: str) -> dict[str, Any]:
    return {
        "type": "conversation.item.input_audio_transcription.completed",
        "item_id": item_id,
        "transcript": text,
    }


def test_each_split_is_completed_once_with_its_own_index() -> None:
    rec = Recorder()
    s = rec.session()
    ws = FakeWs()
    append(s)
    assert not handle(s, delta("item_a", "明日の"))
    split(s, ws)
    append(s)
    # 区切った後に、前の区切りの続きと次の区切りの断片が混ざって届く
    assert not handle(s, delta("item_a", "会議です。"))
    assert not handle(s, delta("item_b", "場所は"))
    assert not handle(s, completed("item_a", "明日の会議です。"))
    end(s, ws)
    assert handle(s, completed("item_b", "場所は品川です。"))
    assert rec.deltas == [(0, "明日の"), (0, "会議です。"), (1, "場所は")]
    assert rec.completed == [(0, "明日の会議です。"), (1, "場所は品川です。")]
    assert [m["type"] for m in ws.sent] == ["input_audio_buffer.commit"] * 2
    assert [m["event_id"] for m in ws.sent] == ["commit-0", "commit-1"]


def test_item_without_deltas_is_bound_in_commit_order() -> None:
    rec = Recorder()
    s = rec.session()
    ws = FakeWs()
    append(s)
    split(s, ws)
    append(s)
    handle(s, {"type": "input_audio_buffer.committed", "item_id": "item_a"})
    handle(s, delta("item_b", "続き"))
    end(s, ws)
    handle(s, completed("item_b", "続きです。"))
    assert rec.completed == [(1, "続きです。")]
    assert handle(s, completed("item_a", "最初です。"))
    assert sorted(rec.completed) == [(0, "最初です。"), (1, "続きです。")]


def test_split_without_audio_is_completed_empty_without_commit() -> None:
    rec = Recorder()
    s = rec.session()
    ws = FakeWs()
    split(s, ws)
    assert rec.completed == [(0, "")]
    assert ws.sent == []
    append(s)
    end(s, ws)
    # 区切り0にはアイテムができないので、最初の item_id は区切り1になる
    assert handle(s, completed("item_x", "はい。"))
    assert rec.completed == [(0, ""), (1, "はい。")]


def test_failed_final_commit_ends_with_empty_text() -> None:
    # 短すぎる発話の commit は error になる。空の全文で確定して終える
    rec = Recorder()
    s = rec.session()
    ws = FakeWs()
    append(s)
    end(s, ws)
    ev = {"type": "error", "error": {"event_id": "commit-0", "message": "buffer too small"}}
    assert handle(s, ev)
    assert rec.completed == [(0, "")]


def test_unmatched_error_after_end_completes_the_last_split() -> None:
    rec = Recorder()
    s = rec.session()
    ws = FakeWs()
    append(s)
    split(s, ws)
    end(s, ws)
    assert not handle(s, {"type": "error", "error": {"message": "?"}})
    assert rec.completed == [(1, "")]
    assert handle(s, completed("item_a", "前半です。"))
    assert rec.completed == [(1, ""), (0, "前半です。")]


def test_unfinished_splits_are_completed_empty_on_done() -> None:
    rec = Recorder()
    s = rec.session()
    ws = FakeWs()
    append(s)
    handle(s, delta("item_a", "途中"))
    split(s, ws)
    s._on_done()  # pyright: ignore[reportPrivateUsage]
    assert rec.completed == [(0, ""), (1, "")]
