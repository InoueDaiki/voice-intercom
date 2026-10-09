"""話者のトラックの状態から、発話の開始と終了を決める。

PTT はトラックを常に publish しておき、ミュートを切り替える。ミュートが外れている間だけ
OpenAI に音声を送る(無音も課金されるため)。ミュート、購読の解除(unpublish や退室を含む)の
どれかで発話を終える。
"""

from enum import Enum, auto


class Action(Enum):
    START = auto()
    END = auto()


class TalkGate:
    def __init__(self) -> None:
        self._subscribed = False
        self._muted = True
        self._open = False

    @property
    def is_open(self) -> bool:
        """音声を OpenAI に送ってよいか。"""
        return self._open

    def subscribed(self, *, muted: bool) -> Action | None:
        self._subscribed = True
        self._muted = muted
        return self._update()

    def unsubscribed(self) -> Action | None:
        self._subscribed = False
        return self._update()

    def muted(self) -> Action | None:
        self._muted = True
        return self._update()

    def unmuted(self) -> Action | None:
        self._muted = False
        return self._update()

    def _update(self) -> Action | None:
        talking = self._subscribed and not self._muted
        if talking == self._open:
            return None
        self._open = talking
        return Action.START if talking else Action.END
