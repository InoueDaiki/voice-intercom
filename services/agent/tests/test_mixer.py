import numpy as np
from voice_intercom_agent.mixer import Mixer


def pcm(*values: int) -> bytes:
    return np.array(values, dtype=np.int16).tobytes()


def samples(data: bytes | None) -> list[int]:
    assert data is not None
    return np.frombuffer(data, dtype=np.int16).tolist()


def test_waits_until_a_full_chunk_arrives() -> None:
    m = Mixer(chunk_samples=4)
    m.push("a", pcm(1, 2))
    assert m.pop() is None
    m.push("a", pcm(3, 4, 5))
    assert samples(m.pop()) == [1, 2, 3, 4]
    assert m.pop() is None


def test_closed_input_is_flushed_with_padding() -> None:
    m = Mixer(chunk_samples=4)
    m.push("a", pcm(1, 2, 3, 4, 5))
    m.close("a")
    assert samples(m.pop()) == [1, 2, 3, 4]
    assert samples(m.pop()) == [5, 0, 0, 0]
    assert m.pop() is None


def test_mixes_two_speakers() -> None:
    m = Mixer(chunk_samples=2)
    m.push("a", pcm(100, 200))
    m.push("b", pcm(10, 20))
    assert samples(m.pop()) == [110, 220]


def test_input_not_ready_is_kept_for_the_next_chunk() -> None:
    m = Mixer(chunk_samples=2)
    m.push("a", pcm(1, 1, 1, 1))
    m.push("b", pcm(5))
    assert samples(m.pop()) == [1, 1]
    m.push("b", pcm(6))
    assert samples(m.pop()) == [6, 7]


def test_clipping() -> None:
    m = Mixer(chunk_samples=1)
    m.push("a", pcm(30000))
    m.push("b", pcm(30000))
    assert samples(m.pop()) == [32767]


def test_closing_an_empty_input_removes_it() -> None:
    m = Mixer(chunk_samples=2)
    m.push("a", pcm(1, 2))
    assert m.pop() is not None
    m.close("a")
    m.push("a", pcm(3, 4))
    # 閉じた後に同じ key で来たものは、新しい入力として扱う
    assert samples(m.pop()) == [3, 4]
