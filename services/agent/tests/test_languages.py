from voice_intercom_agent.languages import normalize, participant_language, target_languages


def test_normalize_keeps_primary_subtag() -> None:
    assert normalize("ja-JP") == "ja"
    assert normalize("zh_Hans") == "zh"
    assert normalize(" EN ") == "en"


def test_normalize_rejects_unsupported_and_empty() -> None:
    assert normalize("th") is None
    assert normalize("") is None
    assert normalize(None) is None


def test_participant_language_reads_attribute() -> None:
    assert participant_language({"language": "ko-KR"}) == "ko"
    assert participant_language({}) is None


def test_targets_exclude_speaker_language() -> None:
    assert target_languages("ja", ["ja", "en", "ko", "en"]) == ["en", "ko"]


def test_targets_ignore_unknown_listeners() -> None:
    assert target_languages("ja", [None, "en"]) == ["en"]


def test_no_targets_when_everyone_shares_the_language() -> None:
    assert target_languages("en", ["en", "en"]) == []


def test_unknown_speaker_translates_to_every_listener_language() -> None:
    assert target_languages(None, ["ja", "en"]) == ["en", "ja"]
