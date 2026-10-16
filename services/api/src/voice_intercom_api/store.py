"""DynamoDB の rooms、room_members、users テーブルの読み書き。

テーブル名は環境変数(ROOMS_TABLE、ROOM_MEMBERS_TABLE、USERS_TABLE)で受け取る。ローカルでは
scripts/with-local-aws.sh が接続先を DynamoDB Local に向ける。

メンバーは room_members テーブルに1人1行(room_id × user_id)で持ち、rooms の行には持たせない。
- ルームのメンバーは room_id の Query(強い整合)、「自分がメンバーのルーム」は
  GSI(user_id-index)の Query で取る。前は rooms の行の member_ids を Scan で絞っていたが、
  ルームの数に比例して重くなるため移した。
- メンバーの置き場所は room_members だけにする。rooms の行にも持たせると2か所を揃え続ける
  必要があり、TransactWriteItems は1回100件までなので、100人のルームを一度に入れ替えられない。
- メンバーの書き換えは1行ずつ(BatchWriteItem)で、トランザクションにしない。途中で失敗すると
  一部だけが変わるが、同じ内容で PATCH し直せば揃う(今ある行との差分だけを書く)。
- GSI は結果整合なので、メンバーに足した直後は、その人の一覧に1秒ほど出ないことがある。
  外した直後に GSI に残っていても、ルームのメンバー(強い整合)で確かめてから返す。
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from functools import cache
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
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
def _resource() -> Any:
    # 接続はウォームスタートの間使い回す
    return boto3.resource("dynamodb")  # pyright: ignore[reportUnknownMemberType]


@cache
def _table(name: str) -> Any:
    return _resource().Table(name)


def _rooms() -> Any:
    return _table(get_settings().rooms_table)


def _members() -> Any:
    return _table(get_settings().room_members_table)


# room_members の GSI(キーは user_id と room_id だけを写す)。infra/envs/<env>/main.tf と揃える
MEMBER_ROOMS_INDEX = "user_id-index"

# BatchGetItem の1回の上限
_BATCH_GET_LIMIT = 100


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


def _query(table: Any, **kwargs: Any) -> Iterator[dict[str, Any]]:
    while True:
        res = table.query(**kwargs)
        yield from res.get("Items", [])
        if "LastEvaluatedKey" not in res:
            return
        kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]


def _batch_get_rooms(room_ids: list[str]) -> list[dict[str, Any]]:
    """rooms の行をまとめて取る(無いものは返さない)。"""
    name = get_settings().rooms_table
    items: list[dict[str, Any]] = []
    for i in range(0, len(room_ids), _BATCH_GET_LIMIT):
        request: dict[str, Any] = {
            name: {"Keys": [{"room_id": rid} for rid in room_ids[i : i + _BATCH_GET_LIMIT]]}
        }
        # 処理しきれなかったキー(UnprocessedKeys)は、返ってこなくなるまで取り直す
        while request:
            res = _resource().batch_get_item(RequestItems=request)
            items.extend(res.get("Responses", {}).get(name, []))
            request = res.get("UnprocessedKeys") or {}
    return items


def _unique(ids: list[str]) -> list[str]:
    # 並びは保ったまま、重複を除く
    return list(dict.fromkeys(ids))


def _room(item: dict[str, Any], member_ids: list[str]) -> Room:
    # 移す前の行には member_ids が残っていることがあるが、使わない(migrate_room_members.py)
    return Room(
        room_id=item["room_id"],
        name=item["name"],
        member_ids=member_ids,
        created_at=item["created_at"],
        updated_at=item["updated_at"],
    )


# メンバー


def _member_ids(room_id: str) -> list[str]:
    """ルームのメンバー(user_id の順)。書き換えの直後にも正しく返すよう、強い整合で読む。"""
    items = _query(
        _members(),
        KeyConditionExpression=Key("room_id").eq(room_id),
        ProjectionExpression="user_id",
        ConsistentRead=True,
    )
    return [item["user_id"] for item in items]


def _all_member_ids() -> dict[str, list[str]]:
    """すべてのルームのメンバー(管理者の一覧用)。"""
    members: dict[str, list[str]] = {}
    for item in _scan(_members()):
        members.setdefault(item["room_id"], []).append(item["user_id"])
    return {room_id: sorted(ids) for room_id, ids in members.items()}


def _set_members(room_id: str, member_ids: list[str]) -> list[str]:
    """ルームのメンバーを member_ids にする。今ある行との差分だけを書き、新しいメンバーを返す。"""
    current = set(_member_ids(room_id))
    wanted = set(member_ids)
    with _members().batch_writer() as batch:
        for user_id in sorted(wanted - current):
            batch.put_item(Item={"room_id": room_id, "user_id": user_id})
        for user_id in sorted(current - wanted):
            batch.delete_item(Key={"room_id": room_id, "user_id": user_id})
    return sorted(wanted)


# ルーム


def list_rooms(member_id: str | None = None) -> list[Room]:
    """ルームの一覧(room_id の順)。member_id を渡すと、その人がメンバーのルームだけにする。"""
    if member_id is None:
        members = _all_member_ids()
        rooms = [_room(item, members.get(item["room_id"], [])) for item in _scan(_rooms())]
        return sorted(rooms, key=lambda r: r.room_id)

    room_ids = [
        item["room_id"]
        for item in _query(
            _members(),
            IndexName=MEMBER_ROOMS_INDEX,
            KeyConditionExpression=Key("user_id").eq(member_id),
        )
    ]
    rooms: list[Room] = []
    # 消したルームの行が残っていれば、rooms に無いので出さない
    for item in _batch_get_rooms(room_ids):
        ids = _member_ids(item["room_id"])
        # GSI は結果整合なので、外した直後の人の行が残っていることがある
        if member_id in ids:
            rooms.append(_room(item, ids))
    return sorted(rooms, key=lambda r: r.room_id)


def get_room(room_id: str) -> Room | None:
    item = _rooms().get_item(Key={"room_id": room_id}).get("Item")
    return None if item is None else _room(item, _member_ids(room_id))


def create_room(room_id: str, name: str, member_ids: list[str]) -> Room:
    ts = now()
    try:
        _rooms().put_item(
            Item={"room_id": room_id, "name": name, "created_at": ts, "updated_at": ts},
            ConditionExpression=Attr("room_id").not_exists(),
        )
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise AlreadyExistsError(room_id) from e
        raise
    # 同じ room_id の前のルームを消したときに、メンバーの行が残っていても消える
    members = _set_members(room_id, member_ids)
    return Room(room_id=room_id, name=name, member_ids=members, created_at=ts, updated_at=ts)


def update_room(room_id: str, *, name: str | None, member_ids: list[str] | None) -> Room:
    values: dict[str, Any] = {"updated_at": now()}
    if name is not None:
        values["name"] = name
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
    members = _member_ids(room_id) if member_ids is None else _set_members(room_id, member_ids)
    return _room(res["Attributes"], members)


def delete_room(room_id: str) -> None:
    try:
        _rooms().delete_item(Key={"room_id": room_id}, ConditionExpression=Attr("room_id").exists())
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise NotFoundError(room_id) from e
        raise
    # 途中で失敗して行が残っても、一覧は rooms に無いルームを出さず、同じ room_id で作り直せば消える
    _set_members(room_id, [])


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
