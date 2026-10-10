"""push 通知の端末トークン(FCM の登録トークン)を、users テーブルの項目に持たせる。

項目の形(users テーブル、キーは user_id):

    devices: {
        <トークンの SHA-256(16進)>: {
            "token": ..., "platform": "ios" | "android", "updated_at": ...
        },
        ...
    }

- マップのキーをトークンそのものにしないのは、トークンが長く(150〜200文字ほど。上限の定めはない)
  `:` などを含むため。式の属性名に入れても困らない、長さの決まったハッシュにする。
- プロフィール(display_name など)とは別の属性なので、`PUT /users/me` の UpdateItem では消えない。
  逆に、ここでもプロフィールの属性には触らない(項目がなければ devices だけの項目ができる)。
- 1人の上限は MAX_DEVICES 台。超えたら、updated_at がいちばん古い端末を外す。アプリは起動の
  たびに登録し直すので、updated_at は「最後に使った時刻」に近い。再インストールで残った古い
  トークンから外れる。
- 同じトークンを別の人が登録したら、前の人から外す。端末の持ち主が変わった(ログアウトせずに
  別の人がログインした)のに前の人の通知が届き続けると、前の人のチャットの中身が見えてしまうため。
  トークンから持ち主を引く索引はなく、users テーブルを Scan して探す。users は招待制で数が少なく、
  登録はアプリの起動時とトークンの更新時だけなので足りる。人数が増えて重くなったら、
  トークンをキーにした項目かテーブルを足す。
"""

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal

from botocore.exceptions import ClientError

from voice_intercom_api import store

Platform = Literal["ios", "android"]

# 1人が登録できる端末の数
MAX_DEVICES = 10

# 上限で外す端末と取り合ったときに、やり直す回数
_MAX_ATTEMPTS = 5

# BatchGetItem の1回の上限
_BATCH_GET_LIMIT = 100


@dataclass(frozen=True)
class Device:
    user_id: str
    token: str
    platform: Platform


def token_key(token: str) -> str:
    """devices マップのキー(トークンの SHA-256)。"""
    return hashlib.sha256(token.encode()).hexdigest()


def _users() -> Any:
    return store._users()  # pyright: ignore[reportPrivateUsage]


def _is_conditional_check_failed(e: ClientError) -> bool:
    return store._is_conditional_check_failed(e)  # pyright: ignore[reportPrivateUsage]


def register(user_id: str, token: str, platform: Platform) -> None:
    """端末を登録する。登録済みなら platform と updated_at を更新する。"""
    key = token_key(token)
    table = _users()
    # 入れ子の属性に SET するには親のマップが要るので、先に作っておく
    table.update_item(
        Key={"user_id": user_id},
        UpdateExpression="SET devices = if_not_exists(devices, :empty)",
        ExpressionAttributeValues={":empty": {}},
    )
    value = {"token": token, "platform": platform, "updated_at": store.now()}
    for _ in range(_MAX_ATTEMPTS):
        try:
            table.update_item(
                Key={"user_id": user_id},
                UpdateExpression="SET devices.#key = :value",
                # 登録済みの端末の更新は、上限に関わらず通す
                ConditionExpression="attribute_exists(devices.#key) OR size(devices) < :max",
                ExpressionAttributeNames={"#key": key},
                ExpressionAttributeValues={":value": value, ":max": MAX_DEVICES},
            )
            break
        except ClientError as e:
            if not _is_conditional_check_failed(e):
                raise
        # 上限に達している。いちばん古い端末を外してからやり直す
        _evict_oldest(user_id, keep=key)
    else:
        raise RuntimeError(f"端末の登録が競合し続けた: {user_id}")

    _remove_from_other_users(key, owner=user_id)


def _evict_oldest(user_id: str, *, keep: str) -> None:
    item = (
        _users()
        .get_item(Key={"user_id": user_id}, ProjectionExpression="devices", ConsistentRead=True)
        .get("Item", {})
    )
    devices: dict[str, Any] = item.get("devices", {})
    candidates = [(d.get("updated_at", ""), k) for k, d in devices.items() if k != keep]
    if len(devices) < MAX_DEVICES or not candidates:
        # 別のリクエストが先に外した
        return
    _, oldest = min(candidates)
    remove(user_id, [oldest])


def _remove_from_other_users(key: str, *, owner: str) -> None:
    items = store._scan(  # pyright: ignore[reportPrivateUsage]
        _users(),
        FilterExpression="attribute_exists(devices.#key) AND user_id <> :owner",
        ProjectionExpression="user_id",
        ExpressionAttributeNames={"#key": key},
        ExpressionAttributeValues={":owner": owner},
    )
    for other in [item["user_id"] for item in items]:
        remove(other, [key])


def unregister(user_id: str, token: str) -> None:
    """端末を外す。登録されていなくても何もしない(ログアウトを失敗させない)。"""
    remove(user_id, [token_key(token)])


def remove(user_id: str, keys: Iterable[str]) -> None:
    """devices からキー(token_key)を外す。無いキーは無視する。項目がなくても作らない。"""
    table = _users()
    for key in keys:
        try:
            table.update_item(
                Key={"user_id": user_id},
                UpdateExpression="REMOVE devices.#key",
                ConditionExpression="attribute_exists(devices.#key)",
                ExpressionAttributeNames={"#key": key},
            )
        except ClientError as e:
            if not _is_conditional_check_failed(e):
                raise


def list_devices(user_ids: Iterable[str]) -> list[Device]:
    """複数の人の端末をまとめて取る(user_id、updated_at の順)。"""
    ids = list(dict.fromkeys(user_ids))
    table = _users()
    # resource の client なので、値は Python の型で読み書きできる
    client = table.meta.client
    items: list[dict[str, Any]] = []
    for i in range(0, len(ids), _BATCH_GET_LIMIT):
        request: dict[str, Any] = {
            table.name: {
                "Keys": [{"user_id": uid} for uid in ids[i : i + _BATCH_GET_LIMIT]],
                "ProjectionExpression": "user_id, devices",
            }
        }
        while request:
            res = client.batch_get_item(RequestItems=request)
            items += res.get("Responses", {}).get(table.name, [])
            request = res.get("UnprocessedKeys") or {}

    devices: list[Device] = []
    for item in sorted(items, key=lambda it: it["user_id"]):
        entries = sorted(item.get("devices", {}).values(), key=lambda d: d.get("updated_at", ""))
        devices += [Device(item["user_id"], d["token"], d["platform"]) for d in entries]
    return devices
