from voice_intercom_agent.captions import CaptionTrack, new_segment_id


def make(translated: bool = False, language: str = "ja") -> CaptionTrack:
    return CaptionTrack(
        speaker_identity="u1", segment_id="seg", language=language, translated=translated
    )


def test_deltas_then_final_with_full_text() -> None:
    track = make()
    first = track.delta("明日の")
    second = track.delta("午後")
    final = track.final("明日の午後3時に")
    assert first is not None and second is not None and final is not None
    assert [first.text, second.text] == ["明日の", "午後"]
    assert not first.is_final
    # 確定は全文で置き換える(断片の連結と一致するとは限らない)
    assert final.text == "明日の午後3時に"
    assert final.is_final
    assert (final.speaker_identity, final.segment_id, final.language) == ("u1", "seg", "ja")
    assert not final.translated


def test_translated_flag_and_language() -> None:
    caption = make(translated=True, language="en").final("Tomorrow at 3 pm")
    assert caption is not None
    assert caption.translated
    assert caption.language == "en"


def test_empty_delta_is_skipped() -> None:
    assert make().delta("") is None


def test_nothing_to_send_when_empty_without_deltas() -> None:
    # 短すぎて文字にならなかった発話は、字幕を出さない
    assert make().final("") is None


def test_empty_final_after_deltas_clears_the_caption() -> None:
    track = make()
    track.delta("えー")
    final = track.final("")
    assert final is not None
    assert final.text == ""
    assert final.is_final


def test_nothing_after_final() -> None:
    track = make()
    track.final("はい")
    assert track.delta("追加") is None
    assert track.final("はい") is None


def test_segment_ids_are_unique() -> None:
    assert new_segment_id() != new_segment_id()


def test_utterance_fields() -> None:
    # 長い発話の区切りは、segment_id を分け、utterance_id と順番で同じ発話とわかるようにする
    track = CaptionTrack(
        speaker_identity="u1",
        segment_id="seg-1",
        language="ja",
        translated=False,
        utterance_id="utt",
        segment_index=1,
    )
    caption = track.final("後半です。")
    assert caption is not None
    assert (caption.segment_id, caption.utterance_id, caption.segment_index) == ("seg-1", "utt", 1)


def test_message_id_for_text_input() -> None:
    track = CaptionTrack(
        speaker_identity="u1", segment_id="seg", language="ja", translated=False, message_id="m1"
    )
    caption = track.final("はい")
    assert caption is not None
    assert caption.message_id == "m1"
    # 音声の字幕では空
    voice = make().final("はい")
    assert voice is not None and voice.message_id == ""
