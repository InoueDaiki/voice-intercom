from voiceintercom.v1.caption_pb2 import Caption
from voiceintercom.v1.text_pb2 import TextMessage


def test_roundtrip() -> None:
    message = TextMessage(message_id="m1", text="在庫は残り1,250個です。")

    decoded = TextMessage.FromString(message.SerializeToString())

    assert decoded == message


def test_caption_carries_message_id() -> None:
    # テキスト入力の字幕は、Caption の message_id で送ったテキストと結び付ける
    caption = Caption(segment_id="s1", text="はい", is_final=True, message_id="m1")

    decoded = Caption.FromString(caption.SerializeToString())

    assert decoded.message_id == "m1"
    assert (decoded.segment_id, decoded.text, decoded.is_final) == ("s1", "はい", True)
