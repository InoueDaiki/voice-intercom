"""送信者としてルームに入り、テキスト入力(TextMessage)を送る。

アプリと同じく、データチャネル(topic "text"、reliable)で送る。送信者と言語は、この参加者の
identity と属性 language から Agent が取る。Agent が配信する字幕(Caption)も表示する。

使い方は services/agent/README.md を参照する。
"""

import argparse
import asyncio
import uuid

from common import add_connection_args, make_token
from livekit import rtc

from voice_intercom_agent.captions import CAPTION_TOPIC
from voice_intercom_agent.text_input import TEXT_TOPIC
from voiceintercom.v1.caption_pb2 import Caption
from voiceintercom.v1.text_pb2 import TextMessage


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    add_connection_args(p, identity="sender")
    p.add_argument("texts", nargs="+", help="送るテキスト。1つが1通")
    p.add_argument("--gap", type=float, default=6.0, help="次のテキストを送るまでの秒数")
    p.add_argument("--wait", type=float, default=2.0, help="入室してから最初に送るまでの秒数")
    args = p.parse_args()

    room = rtc.Room()

    @room.on("data_received")
    def _(packet: rtc.DataPacket) -> None:
        if packet.topic != CAPTION_TOPIC:
            return
        caption = Caption.FromString(packet.data)
        if caption.message_id and caption.is_final:
            kind = "訳" if caption.translated else "原文"
            print(f"  {kind}({caption.language or '?'}) {caption.text}  [{caption.message_id[:8]}]")

    await room.connect(args.url, make_token(args), rtc.RoomOptions(auto_subscribe=False))
    print(f"入室した: {args.room} / {args.identity}({args.language})")
    # Agent が入って、読み上げのセッションを開くのを待つ
    await asyncio.sleep(args.wait)

    for text in args.texts:
        message = TextMessage(message_id=uuid.uuid4().hex, text=text)
        await room.local_participant.publish_data(
            message.SerializeToString(), reliable=True, topic=TEXT_TOPIC
        )
        print(f"送った: {text}  [{message.message_id[:8]}]")
        await asyncio.sleep(args.gap)

    await room.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
