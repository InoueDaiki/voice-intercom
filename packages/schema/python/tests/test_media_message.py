from voiceintercom.v1.media_pb2 import MediaMessage


def test_roundtrip() -> None:
    message = MediaMessage(
        event_id="2026-10-10T00:00:00.000Z#0123456789abcdef0123456789abcdef",
        sender_identity="user-1",
        occurred_at="2026-10-10T00:00:00.000Z",
        media_id="0123456789abcdef0123456789abcdef",
        content_type="image/jpeg",
        url="https://media.example/rooms/r/m/original",
        size_bytes=1234,
        text="現場の写真",
        language="ja",
    )

    decoded = MediaMessage.FromString(message.SerializeToString())

    assert decoded == message
    # 無いサムネイルは空文字、切り詰めていなければ false
    assert decoded.thumbnail_url == ""
    assert decoded.text_truncated is False
