from voiceintercom.v1.deletion_pb2 import DeletionMessage


def test_roundtrip() -> None:
    message = DeletionMessage(
        event_id="2026-10-10T00:00:00.000Z#abc",
        sender_identity="user-1",
        kind="text",
        message_id="m1",
        deleted_at="2026-10-10T00:01:00.000Z",
    )

    decoded = DeletionMessage.FromString(message.SerializeToString())

    assert decoded == message
