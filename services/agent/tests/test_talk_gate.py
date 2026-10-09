from voice_intercom_agent.talk_gate import Action, TalkGate


def test_unmute_starts_and_mute_ends() -> None:
    gate = TalkGate()
    assert gate.subscribed(muted=True) is None
    assert not gate.is_open
    assert gate.unmuted() is Action.START
    assert gate.is_open
    assert gate.muted() is Action.END
    assert not gate.is_open


def test_subscribing_an_unmuted_track_starts() -> None:
    # lk CLI で ogg を publish したときなど、最初からミュートされていないトラック
    gate = TalkGate()
    assert gate.subscribed(muted=False) is Action.START


def test_unsubscribe_ends_the_utterance() -> None:
    # unpublish や退室では、ミュートを経ずに購読が解除される
    gate = TalkGate()
    gate.subscribed(muted=False)
    assert gate.unsubscribed() is Action.END
    assert not gate.is_open


def test_repeated_events_do_not_restart() -> None:
    gate = TalkGate()
    gate.subscribed(muted=True)
    assert gate.unmuted() is Action.START
    assert gate.unmuted() is None
    assert gate.muted() is Action.END
    assert gate.muted() is None
    assert gate.unsubscribed() is None


def test_unmute_before_subscribe_does_not_start() -> None:
    gate = TalkGate()
    assert gate.unmuted() is None
    assert gate.subscribed(muted=False) is Action.START


def test_each_press_is_a_new_utterance() -> None:
    gate = TalkGate()
    gate.subscribed(muted=True)
    actions = [gate.unmuted(), gate.muted(), gate.unmuted(), gate.muted()]
    assert actions == [Action.START, Action.END, Action.START, Action.END]
