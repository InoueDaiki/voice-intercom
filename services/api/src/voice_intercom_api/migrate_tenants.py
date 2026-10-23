"""テナントを入れる前のユーザーとルームを、1つのテナントへ移す(1回だけ実行する)。

docs/設計メモ.md の「前のデータの移し方」。何度実行してもよい。
- テナントが無ければ作る。
- プロフィールを登録していて所属の無いユーザーを、そのテナントに入れる。
- tenant_id の無いルームを Private にして、そのテナントに入れる。
- メンバーの行に、役割(member)とテナントを書く(役割を持つ行は変えない)。オーナーは決めない。

ローカル:
    scripts/with-local-aws.sh uv run python -m voice_intercom_api.migrate_tenants <tenant_id> <名前>
dev(テーブル名は terraform output table_names):
    TENANTS_TABLE=voice-intercom-dev-tenants USERS_TABLE=voice-intercom-dev-users \\
    ROOMS_TABLE=voice-intercom-dev-rooms ROOM_MEMBERS_TABLE=voice-intercom-dev-room-members \\
        uv run python -m voice_intercom_api.migrate_tenants <tenant_id> <名前>
"""

import os
import sys
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError


def _scan(table: Any, **kwargs: Any) -> Iterator[dict[str, Any]]:
    while True:
        res = table.scan(**kwargs)
        yield from res.get("Items", [])
        if "LastEvaluatedKey" not in res:
            return
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def migrate(tenant_id: str, name: str) -> None:
    dynamodb = boto3.resource("dynamodb")  # pyright: ignore[reportUnknownMemberType]
    tenants = dynamodb.Table(os.environ["TENANTS_TABLE"])  # pyright: ignore[reportAttributeAccessIssue]
    users = dynamodb.Table(os.environ["USERS_TABLE"])  # pyright: ignore[reportAttributeAccessIssue]
    rooms = dynamodb.Table(os.environ["ROOMS_TABLE"])  # pyright: ignore[reportAttributeAccessIssue]
    members = dynamodb.Table(os.environ["ROOM_MEMBERS_TABLE"])  # pyright: ignore[reportAttributeAccessIssue]
    now = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    try:
        tenants.put_item(
            Item={"tenant_id": tenant_id, "name": name, "created_at": now},
            ConditionExpression=Attr("tenant_id").not_exists(),
        )
        print(f"テナントを作った: {tenant_id}")
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        print(f"テナントは既にある: {tenant_id}")

    # 所属の無いユーザー(端末トークンだけの行は除く)
    no_tenant = Attr("display_name").exists() & Attr("tenant_id").not_exists()
    for item in _scan(users, FilterExpression=no_tenant, ProjectionExpression="user_id"):
        users.update_item(
            Key={"user_id": item["user_id"]},
            UpdateExpression="SET tenant_id = :t",
            ExpressionAttributeValues={":t": tenant_id},
        )
        print(f"ユーザー {item['user_id']} を入れた")

    for item in _scan(rooms, FilterExpression=Attr("tenant_id").not_exists()):
        rooms.update_item(
            Key={"room_id": item["room_id"]},
            UpdateExpression="SET tenant_id = :t, #kind = :k",
            ExpressionAttributeNames={"#kind": "kind"},
            ExpressionAttributeValues={":t": tenant_id, ":k": "private"},
        )
        print(f"ルーム {item['room_id']} を入れた")

    for item in _scan(members, FilterExpression=Attr("role").not_exists()):
        members.update_item(
            Key={"room_id": item["room_id"], "user_id": item["user_id"]},
            UpdateExpression="SET #role = :r, tenant_id = if_not_exists(tenant_id, :t)",
            # 予約語と重ならないよう、属性名を置き換える
            ExpressionAttributeNames={"#role": "role"},
            ExpressionAttributeValues={":r": "member", ":t": tenant_id},
        )
    print("移し終えた")


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit("使い方: python -m voice_intercom_api.migrate_tenants <tenant_id> <名前>")
    migrate(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
