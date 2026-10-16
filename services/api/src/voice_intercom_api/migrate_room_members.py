"""rooms の行の member_ids を、room_members テーブルへ移す(1回だけ実行する)。

メンバーを room_members に移す前に作ったルームのためのもの。何度実行してもよい。
- member_ids の人を room_members に足し(今いる人は外さない)、rooms の行から member_ids を消す。
- 足し終えてから消すので、途中で失敗しても、もう一度実行すれば移る。

ローカル:
    scripts/with-local-aws.sh uv run python -m voice_intercom_api.migrate_room_members
dev(テーブル名は terraform output table_names):
    ROOMS_TABLE=voice-intercom-dev-rooms ROOM_MEMBERS_TABLE=voice-intercom-dev-room-members \\
        uv run python -m voice_intercom_api.migrate_room_members
"""

import os

import boto3
from boto3.dynamodb.conditions import Attr


def main() -> None:
    dynamodb = boto3.resource("dynamodb")  # pyright: ignore[reportUnknownMemberType]
    rooms = dynamodb.Table(os.environ["ROOMS_TABLE"])  # pyright: ignore[reportAttributeAccessIssue]
    members = dynamodb.Table(os.environ["ROOM_MEMBERS_TABLE"])  # pyright: ignore[reportAttributeAccessIssue]

    kwargs = {"FilterExpression": Attr("member_ids").exists()}
    moved = 0
    while True:
        res = rooms.scan(**kwargs)
        for item in res.get("Items", []):
            room_id = item["room_id"]
            member_ids = list(dict.fromkeys(item["member_ids"]))
            with members.batch_writer() as batch:
                for user_id in member_ids:
                    batch.put_item(Item={"room_id": room_id, "user_id": user_id})
            rooms.update_item(Key={"room_id": room_id}, UpdateExpression="REMOVE member_ids")
            print(f"{room_id}: {len(member_ids)}人を移した")
            moved += 1
        if "LastEvaluatedKey" not in res:
            break
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]
    print(f"移したルーム: {moved}")


if __name__ == "__main__":
    main()
