"""DynamoDB の rooms テーブルと users テーブルの読み書き。

テーブル名は環境変数(ROOMS_TABLE、USERS_TABLE)で受け取る。ローカルでは scripts/with-local-aws.sh が
接続先を DynamoDB Local に向ける。

「自分がメンバーのルーム」は、rooms テーブルを Scan し、member_ids で絞って取る。
- ルームの数は少なく(運用者が管理コンソールで作る)、1件も最大100人ぶんの ID なので、Scan で足りる。
- GSI はリストの要素をキーにできない。users 側にも所属を持たせると、2つのテーブルを
  トランザクションで揃え続ける必要があり、ルームの数に見合わない。
ルームが増えて Scan が重くなったら、(user_id, room_id)の所属テーブルか GSI を足す。
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from functools import cache
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from voice_intercom_api.config import get_settings
from voice_intercom_api.models import Room, User


class AlreadyExistsError(Exception):
    pass


class NotFoundError(Exception):
    pass


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@cache
def _table(name: str) -> Any:
    # 接続はウォームスタートの間使い回す
    return boto3.resource("dynamodb").Table(name)  # pyright: ignore[reportAttributeAccessIssue]


def _rooms() -> Any:
    return _table(get_settings().rooms_table)


def _users() -> Any:
    return _table(get_settings().users_table)


def _is_conditional_check_failed(e: ClientError) -> bool:
    return e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def _scan(table: Any, **kwargs: Any) -> Iterator[dict[str, Any]]:
    while True:
        res = table.scan(**kwargs)
        yield from res.get("Items", [])
        if "LastEvaluatedKey" not in res:
            return
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def _unique(ids: list[str]) -> list[str]:
    # 並びは保ったまま、重複を除く
    return list(dict.fromkeys(ids))


# ルーム


def list_rooms(member_id: str | None = None) -> list[Room]:
    """ルームの一覧(room_id の順)。member_id を渡すと、その人がメンバーのルームだけにする。"""
    kwargs = (
        {} if member_id is None else {"FilterExpression": Attr("member_ids").contains(member_id)}
    )
    rooms = [Room.model_validate(item) for item in _scan(_rooms(), **kwargs)]
    return sorted(rooms, key=lambda r: r.room_id)


def get_room(room_id: str) -> Room | None:
    item = _rooms().get_item(Key={"room_id": room_id}).get("Item")
    return None if item is None else Room.model_validate(item)


def create_room(room_id: str, name: str, member_ids: list[str]) -> Room:
    ts = now()
    room = Room(
        room_id=room_id, name=name, member_ids=_unique(member_ids), created_at=ts, updated_at=ts
    )
    try:
        _rooms().put_item(Item=room.model_dump(), ConditionExpression=Attr("room_id").not_exists())
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise AlreadyExistsError(room_id) from e
        raise
    return room


def update_room(room_id: str, *, name: str | None, member_ids: list[str] | None) -> Room:
    values: dict[str, Any] = {"updated_at": now()}
    if name is not None:
        values["name"] = name
    if member_ids is not None:
        values["member_ids"] = _unique(member_ids)
    try:
        res = _rooms().update_item(
            Key={"room_id": room_id},
            UpdateExpression="SET " + ", ".join(f"#{k} = :{k}" for k in values),
            # name は DynamoDB の予約語なので、属性名はすべて置き換える
            ExpressionAttributeNames={f"#{k}": k for k in values},
            ExpressionAttributeValues={f":{k}": v for k, v in values.items()},
            ConditionExpression=Attr("room_id").exists(),
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise NotFoundError(room_id) from e
        raise
    return Room.model_validate(res["Attributes"])


def delete_room(room_id: str) -> None:
    try:
        _rooms().delete_item(Key={"room_id": room_id}, ConditionExpression=Attr("room_id").exists())
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise NotFoundError(room_id) from e
        raise


# ユーザー


def list_users() -> list[User]:
    """プロフィールを登録したユーザーの一覧(user_id の順)。"""
    # 端末トークンだけを登録した人(device_store.py)の項目には display_name がない
    items = _scan(_users(), FilterExpression=Attr("display_name").exists())
    users = [User.model_validate(item) for item in items]
    return sorted(users, key=lambda u: u.user_id)


def get_user(user_id: str) -> User | None:
    item = _users().get_item(Key={"user_id": user_id}).get("Item")
    # 端末トークンだけの項目は、プロフィールが未登録として扱う
    return None if item is None or "display_name" not in item else User.model_validate(item)


def put_user(user_id: str, *, display_name: str, language: str) -> User:
    """プロフィールを作るか更新する。

    users テーブルには FCM の端末トークンなども持たせるので、PutItem で置き換えず、
    項目だけを更新する。
    """
    ts = now()
    res = _users().update_item(
        Key={"user_id": user_id},
        UpdateExpression=(
            "SET display_name = :display_name, #language = :language, "
            "updated_at = :now, created_at = if_not_exists(created_at, :now)"
        ),
        ExpressionAttributeNames={"#language": "language"},
        ExpressionAttributeValues={
            ":display_name": display_name,
            ":language": language,
            ":now": ts,
        },
        ReturnValues="ALL_NEW",
    )
    return User.model_validate(res["Attributes"])
