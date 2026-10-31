"""DynamoDB の rooms、room_members、users、tenants テーブルの読み書き。

テーブル名は環境変数(ROOMS_TABLE、ROOM_MEMBERS_TABLE、USERS_TABLE、TENANTS_TABLE)で受け取る。
ローカルでは scripts/with-local-aws.sh が接続先を DynamoDB Local に向ける。

テナントとルームの種別は docs/設計メモ.md の「テナントとルームの種別」。
- ルームの行は、作ったテナント(tenant_id)、種別(kind)、アーカイブした時刻(archived_at)、
  削除を始めた時刻(deleting_at。room_cleanup.py の後始末が終わるまで)を持つ。
  Connect は相手のテナント(connect_tenant_id)と、申請中か(connect_status)も持つ。
  テナントのルームは GSI(tenant_id-index、connect_tenant_id-index)で引く。
- メンバーの行は、役割(role。owner か member)と、その人のテナント(tenant_id)を持つ。

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

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import cache
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from voice_intercom_api.config import get_settings
from voice_intercom_api.models import Room, RoomMember, Tenant, User


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
# rooms の GSI(行をすべて写す)。作ったテナントと、Connect の相手のテナントで引く
TENANT_ROOMS_INDEX = "tenant_id-index"
CONNECT_ROOMS_INDEX = "connect_tenant_id-index"
# users の GSI(行をすべて写す)。テナントのユーザーを引く
TENANT_USERS_INDEX = "tenant_id-index"

# BatchGetItem の1回の上限
_BATCH_GET_LIMIT = 100


def _users() -> Any:
    return _table(get_settings().users_table)


def _tenants() -> Any:
    return _table(get_settings().tenants_table)


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


def _batch_get(
    name: str, key: str, ids: list[str], *, consistent: bool = False
) -> list[dict[str, Any]]:
    """行をまとめて取る(無いものは返さない)。"""
    items: list[dict[str, Any]] = []
    ids = _unique(ids)
    for i in range(0, len(ids), _BATCH_GET_LIMIT):
        request: dict[str, Any] = {
            name: {
                "Keys": [{key: v} for v in ids[i : i + _BATCH_GET_LIMIT]],
                "ConsistentRead": consistent,
            }
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


@dataclass(frozen=True)
class Member:
    """メンバーの行。"""

    user_id: str
    role: str
    # その人のテナント。移す前の行(migrate_tenants.py)には無い
    tenant_id: str


def _member(item: dict[str, Any]) -> Member:
    return Member(
        user_id=item["user_id"],
        role=item.get("role", "member"),
        tenant_id=item.get("tenant_id", ""),
    )


def _room(item: dict[str, Any], members: list[Member]) -> Room:
    # 移す前の行には member_ids が残っていることがあるが、使わない(migrate_room_members.py)。
    # テナントと種別の無い行は、移す前のもの(migrate_tenants.py)
    return Room(
        room_id=item["room_id"],
        name=item["name"],
        kind=item.get("kind", "private"),
        tenant_id=item.get("tenant_id", ""),
        connect_tenant_id=item.get("connect_tenant_id"),
        connect_status=item.get("connect_status"),
        member_ids=[m.user_id for m in members],
        owner_ids=[m.user_id for m in members if m.role == "owner"],
        archived_at=item.get("archived_at"),
        deleting_at=item.get("deleting_at"),
        created_at=item["created_at"],
        updated_at=item["updated_at"],
    )


# メンバー


def members_of(room_id: str) -> list[Member]:
    """ルームのメンバー(user_id の順)。書き換えの直後にも正しく返すよう、強い整合で読む。"""
    items = _query(
        _members(),
        KeyConditionExpression=Key("room_id").eq(room_id),
        ConsistentRead=True,
    )
    return [_member(item) for item in items]


def current_member_ids(room: Room) -> list[str]:
    """メンバーのうち、行のテナントが今の所属と同じ人(通知の宛先)。

    routing.py の is_member と同じ条件を、1人ずつ読まずに確かめる。所属を変えた直後は、
    元のテナントのルームに行が残っている(tenants.py)。
    """
    members = members_of(room.room_id)
    users = _batch_get(
        get_settings().users_table, "user_id", [m.user_id for m in members], consistent=True
    )
    tenants = {item["user_id"]: item.get("tenant_id") for item in users}
    return [m.user_id for m in members if tenants.get(m.user_id) == (m.tenant_id or room.tenant_id)]


def put_member(room_id: str, user_id: str, *, role: str, tenant_id: str) -> None:
    """メンバーに足すか、役割を変える。"""
    put_members(room_id, [Member(user_id=user_id, role=role, tenant_id=tenant_id)])


def put_members(room_id: str, members: Iterable[Member]) -> None:
    with _members().batch_writer() as batch:
        for m in members:
            batch.put_item(
                Item={
                    "room_id": room_id,
                    "user_id": m.user_id,
                    "role": m.role,
                    "tenant_id": m.tenant_id,
                }
            )


def delete_member(room_id: str, user_id: str) -> None:
    _members().delete_item(Key={"room_id": room_id, "user_id": user_id})


def member_tenant(room_id: str, user_id: str) -> str | None:
    """メンバーの行のテナント。メンバーでなければ None、移す前の行なら空文字。"""
    item = (
        _members()
        .get_item(Key={"room_id": room_id, "user_id": user_id}, ConsistentRead=True)
        .get("Item")
    )
    return None if item is None else item.get("tenant_id", "")


def memberships_outside(user_id: str, tenant_id: str | None) -> list[str]:
    """その人のメンバーの行のうち、テナントが tenant_id でないもののルーム(所属を変えたとき)。

    移す前の行(テナントが無い)は、ルームを作ったテナントの人として扱う。行が残っていて rooms に
    無いルームも返す。GSI は結果整合なので、足した直後の行が漏れることはあるが、その行は
    routing.py の今の所属の確かめで使えない。
    """
    room_ids = [
        item["room_id"]
        for item in _query(
            _members(),
            IndexName=MEMBER_ROOMS_INDEX,
            KeyConditionExpression=Key("user_id").eq(user_id),
        )
    ]
    rooms = {
        item["room_id"]: item
        for item in _batch_get(get_settings().rooms_table, "room_id", room_ids)
    }
    outside: list[str] = []
    for room_id in room_ids:
        home = member_tenant(room_id, user_id)
        if home is None:
            continue
        if (home or rooms.get(room_id, {}).get("tenant_id")) != tenant_id:
            outside.append(room_id)
    return outside


def _clear_members(room_id: str) -> None:
    with _members().batch_writer() as batch:
        for m in members_of(room_id):
            batch.delete_item(Key={"room_id": room_id, "user_id": m.user_id})


# ルーム


def _rooms_with_members(items: Iterable[dict[str, Any]]) -> list[Room]:
    rooms = [_room(item, members_of(item["room_id"])) for item in items]
    return sorted(rooms, key=lambda r: (r.name, r.room_id))


def list_member_rooms(user_id: str, tenant_id: str) -> list[Room]:
    """その人がメンバーのルーム(名前の順)。申請中の Connect と、消している途中のルームは出さない。

    メンバーの行のテナントが今の所属(tenant_id)と違うルームも出さない(所属を変えたときの
    後始末が途中で止まった行)。
    """
    room_ids = [
        item["room_id"]
        for item in _query(
            _members(),
            IndexName=MEMBER_ROOMS_INDEX,
            KeyConditionExpression=Key("user_id").eq(user_id),
        )
    ]
    # 消したルームの行が残っていれば、rooms に無いので出さない
    items = [
        item
        for item in _batch_get(get_settings().rooms_table, "room_id", room_ids)
        if item.get("connect_status") != "pending" and "deleting_at" not in item
    ]
    rooms: list[Room] = []
    for item in items:
        members = members_of(item["room_id"])
        # GSI は結果整合なので、外した直後の人の行が残っていることがある
        mine = next((m for m in members if m.user_id == user_id), None)
        if mine is not None and (mine.tenant_id or item.get("tenant_id")) == tenant_id:
            rooms.append(_room(item, members))
    return sorted(rooms, key=lambda r: (r.name, r.room_id))


def _tenant_room_items(tenant_id: str) -> list[dict[str, Any]]:
    """テナントが作ったルームと、相手になっている Connect のルームの行。"""
    own = _query(
        _rooms(),
        IndexName=TENANT_ROOMS_INDEX,
        KeyConditionExpression=Key("tenant_id").eq(tenant_id),
    )
    connected = _query(
        _rooms(),
        IndexName=CONNECT_ROOMS_INDEX,
        KeyConditionExpression=Key("connect_tenant_id").eq(tenant_id),
    )
    return [*own, *connected]


def list_tenant_rooms(tenant_id: str) -> list[Room]:
    """テナントに関わるルーム(管理者の一覧。名前の順)。

    申請中の Connect も出す。消している途中のルーム(deleting_at)は、DELETE をやり直せる
    ルームを作ったテナントにだけ出し、Connect の相手には出さない。
    """
    return _rooms_with_members(
        item
        for item in _tenant_room_items(tenant_id)
        if "deleting_at" not in item or item.get("tenant_id") == tenant_id
    )


def list_joinable_rooms(tenant_id: str, user_id: str) -> list[Room]:
    """テナントの Public のルームのうち、その人がまだ参加していないもの(アーカイブを除く)。"""
    items = [
        item
        for item in _query(
            _rooms(),
            IndexName=TENANT_ROOMS_INDEX,
            KeyConditionExpression=Key("tenant_id").eq(tenant_id),
        )
        if item.get("kind") == "public" and "archived_at" not in item and "deleting_at" not in item
    ]
    return [r for r in _rooms_with_members(items) if user_id not in r.member_ids]


def get_room(room_id: str) -> Room | None:
    """ルームを強い整合で読む。

    無い・アーカイブしたという判定が LiveKit のルームを閉じる判断につながるので、書いた直後の
    古い行で判定しない。
    """
    item = _rooms().get_item(Key={"room_id": room_id}, ConsistentRead=True).get("Item")
    return None if item is None else _room(item, members_of(room_id))


def create_room(
    room_id: str,
    name: str,
    member_ids: Iterable[str] = (),
    *,
    tenant_id: str,
    kind: str = "private",
    owner_ids: Iterable[str] = (),
    connect_tenant_id: str | None = None,
) -> Room:
    """ルームを作る。member_ids と owner_ids の人は、ルームのテナントの人としてメンバーにする。

    connect_tenant_id を渡すと、申請中(connect_status が pending)の Connect として作る。
    """
    ts = now()
    item: dict[str, Any] = {
        "room_id": room_id,
        "name": name,
        "kind": kind,
        "tenant_id": tenant_id,
        "created_at": ts,
        "updated_at": ts,
    }
    if connect_tenant_id is not None:
        item["connect_tenant_id"] = connect_tenant_id
        item["connect_status"] = "pending"
    try:
        _rooms().put_item(Item=item, ConditionExpression=Attr("room_id").not_exists())
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise AlreadyExistsError(room_id) from e
        raise
    # 同じ room_id の前のルームを消したときに、メンバーの行が残っていても消える
    _clear_members(room_id)
    owners = set(owner_ids)
    members = [
        Member(user_id=uid, role="owner" if uid in owners else "member", tenant_id=tenant_id)
        for uid in sorted(set(member_ids) | owners)
    ]
    put_members(room_id, members)
    return _room(item, members)


# update_room に渡すと、その項目を消す(アーカイブを戻すとき)
REMOVE = object()


def update_room(room_id: str, **values: Any) -> Room:
    """ルームの行の項目(name、kind、archived_at、deleting_at、connect_status)を変える。

    値が REMOVE なら消す。

    updated_at も変える。無いルームなら NotFoundError。
    """
    sets = {"updated_at": now()} | {k: v for k, v in values.items() if v is not REMOVE}
    removes = [k for k, v in values.items() if v is REMOVE]
    expression = "SET " + ", ".join(f"#{k} = :{k}" for k in sets)
    if removes:
        expression += " REMOVE " + ", ".join(f"#{k}" for k in removes)
    try:
        res = _rooms().update_item(
            Key={"room_id": room_id},
            UpdateExpression=expression,
            # name は DynamoDB の予約語なので、属性名はすべて置き換える
            ExpressionAttributeNames={f"#{k}": k for k in [*sets, *removes]},
            ExpressionAttributeValues={f":{k}": v for k, v in sets.items()},
            ConditionExpression=Attr("room_id").exists(),
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise NotFoundError(room_id) from e
        raise
    return _room(res["Attributes"], members_of(room_id))


def delete_room(room_id: str) -> None:
    """メンバーと rooms の行を消す。履歴とメディアは呼び出し側が先に消す(room_cleanup.py)。

    rooms の行を後に消すので、途中で失敗しても、行が残っていれば DELETE をやり直せる。
    """
    _clear_members(room_id)
    try:
        _rooms().delete_item(Key={"room_id": room_id}, ConditionExpression=Attr("room_id").exists())
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise NotFoundError(room_id) from e
        raise


def room_members(room_id: str) -> list[RoomMember]:
    """メンバーの一覧(user_id の順)に表示名を付ける。"""
    members = members_of(room_id)
    names = {
        item["user_id"]: item.get("display_name")
        for item in _batch_get(get_settings().users_table, "user_id", [m.user_id for m in members])
    }
    return [
        RoomMember(
            user_id=m.user_id,
            role="owner" if m.role == "owner" else "member",
            tenant_id=m.tenant_id,
            display_name=names.get(m.user_id),
        )
        for m in members
    ]


# テナント


def create_tenant(tenant_id: str, name: str) -> Tenant:
    item = {"tenant_id": tenant_id, "name": name, "created_at": now()}
    try:
        _tenants().put_item(Item=item, ConditionExpression=Attr("tenant_id").not_exists())
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise AlreadyExistsError(tenant_id) from e
        raise
    return Tenant.model_validate(item)


def get_tenant(tenant_id: str) -> Tenant | None:
    item = _tenants().get_item(Key={"tenant_id": tenant_id}).get("Item")
    return None if item is None else Tenant.model_validate(item)


def list_tenants() -> list[Tenant]:
    tenants = [Tenant.model_validate(item) for item in _scan(_tenants())]
    return sorted(tenants, key=lambda t: t.tenant_id)


# ユーザー


def list_users(tenant_id: str | None = None) -> list[User]:
    """プロフィールを登録したユーザーの一覧(user_id の順)。

    tenant_id を渡すと、そのテナントの人だけにする。
    """
    # 端末トークンだけを登録した人(device_store.py)の項目には display_name がない
    has_profile = Attr("display_name").exists()
    if tenant_id is None:
        items = _scan(_users(), FilterExpression=has_profile)
    else:
        items = _query(
            _users(),
            IndexName=TENANT_USERS_INDEX,
            KeyConditionExpression=Key("tenant_id").eq(tenant_id),
            FilterExpression=has_profile,
        )
    users = [User.model_validate(item) for item in items]
    return sorted(users, key=lambda u: u.user_id)


def get_users(user_ids: list[str]) -> dict[str, User]:
    """プロフィールを登録したユーザーを user_id で引く(無い人は入れない)。"""
    items = _batch_get(get_settings().users_table, "user_id", user_ids)
    return {item["user_id"]: User.model_validate(item) for item in items if "display_name" in item}


def tenant_of(user_id: str) -> str | None:
    """その人のテナント。所属が無ければ None。"""
    item = _users().get_item(Key={"user_id": user_id}, ProjectionExpression="tenant_id").get("Item")
    return None if item is None else item.get("tenant_id")


def set_user_tenant(user_id: str, tenant_id: str | None) -> User:
    """所属を変える(None なら外す)。プロフィールの無い人なら NotFoundError。"""
    if tenant_id is None:
        update: dict[str, Any] = {"UpdateExpression": "SET updated_at = :now REMOVE tenant_id"}
        values = {":now": now()}
    else:
        update = {"UpdateExpression": "SET tenant_id = :tenant_id, updated_at = :now"}
        values = {":tenant_id": tenant_id, ":now": now()}
    try:
        res = _users().update_item(
            Key={"user_id": user_id},
            ExpressionAttributeValues=values,
            ConditionExpression=Attr("display_name").exists(),
            ReturnValues="ALL_NEW",
            **update,
        )
    except ClientError as e:
        if _is_conditional_check_failed(e):
            raise NotFoundError(user_id) from e
        raise
    return User.model_validate(res["Attributes"])


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
