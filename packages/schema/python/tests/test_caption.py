from voiceintercom.v1.caption_pb2 import Caption


def test_roundtrip() -> None:
    caption = Caption(speaker_identity="u1", segment_id="s1", language="ja", text="こんにちは")

    decoded = Caption.FromString(caption.SerializeToString())

    assert decoded == caption
