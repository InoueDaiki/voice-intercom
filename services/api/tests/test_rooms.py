import json
from collections.abc import Callable
from typing import Any

import pytest
from conftest import auth_headers, http_event

from voice_intercom_api import (
    migrate_room_members,
    migrate_tenants,
    participants,
    room_cleanup,
    store,
)
from voice_intercom_api.app import handler

pytestmark = pytest.mark.usefixtures("tables")

Token = Callable[..., str]


class FakeCleanup:
    """room_cleanup の代わり(中身は test_room_cleanup.py で確かめる)。"""

    def __init__(self) -> None:
        self.evicted: list[tuple[str, list[str]]] = []
        self.closed: list[str] = []
        self.deleted: list[str] = []
        self.evicted_from: list[tuple[list[str], str]] = []
        self.evict_failures: set[str] = set()
        self.purge_finishes = True

    def evict(self, room_id: str, user_ids: list[str]) -> list[str]:
        self.evicted.append((room_id, user_ids))
        return user_ids

    def evict_from_rooms(self, room_ids: list[str], user_id: str) -> list[str]:
        self.evicted_from.append((sorted(room_ids), user_id))
        return [room_id for room_id in room_ids if room_id in self.evict_failures]

    def close_livekit_room(self, room_id: str) -> bool:
        self.closed.append(room_id)
        return True

    def after_delete(self, room_id: str) -> bool:
        self.deleted.append(room_id)
        return self.purge_finishes


@pytest.fixture(autouse=True)
def cleanup(monkeypatch: pytest.MonkeyPatch) -> FakeCleanup:
    fake = FakeCleanup()
    monkeypatch.setattr(room_cleanup, "evict", fake.evict)
    monkeypatch.setattr(room_cleanup, "evict_from_rooms", fake.evict_from_rooms)
    monkeypatch.setattr(room_cleanup, "close_livekit_room", fake.close_livekit_room)
    monkeypatch.setattr(room_cleanup, "after_delete", fake.after_delete)
    return fake


# テナント t1 の人: owner-1、member-1、member-2、admin-1(管理者)。
# テナント t2 の人: outsider-1、admin-2(管理者)。nobody は所属が無い
USERS = {
    "owner-1": "t1",
    "member-1": "t1",
    "member-2": "t1",
    "admin-1": "t1",
    "outsider-1": "t2",
    "admin-2": "t2",
    "nobody": None,
}


@pytest.fixture(autouse=True)
def seed(tables: None) -> None:
    store.create_tenant("t1", "テナント1")
    store.create_tenant("t2", "テナント2")
    for user_id, tenant_id in USERS.items():
        store.put_user(user_id, display_name=f"{user_id} さん", language="ja")
        if tenant_id:
            store.set_user_tenant(user_id, tenant_id)
    store.create_room("room-a", "A", ["member-1"], tenant_id="t1", owner_ids=["owner-1"])
    store.create_room("room-b", "B", ["member-2"], tenant_id="t1")
    store.create_room("room-p", "P", tenant_id="t1", kind="public", owner_ids=["owner-1"])
    store.create_room("room-q", "Q", tenant_id="t2", kind="public", owner_ids=["outsider-1"])


@pytest.fixture
def token(make_token: Token) -> Callable[[str], str]:
    def make(user_id: str) -> str:
        groups = ["admin"] if user_id.startswith("admin") else []
        if user_id.startswith("operator"):
            groups = ["operator"]
        return make_token(sub=user_id, **{"cognito:groups": groups})

    return make


def call(
    method: str, path: str, token: str | None, body: Any = None, **query: str
) -> tuple[int, Any]:
    event = http_event(method, path, body=body, headers=auth_headers(token))
    if query:
        event["rawQueryString"] = "&".join(f"{k}={v}" for k, v in query.items())
        event["queryStringParameters"] = query
    res = handler(event, None)  # pyright: ignore[reportArgumentType]
    return res["statusCode"], json.loads(res["body"]) if res["body"] else None


def room_ids(body: dict) -> list[str]:
    return [r["room_id"] for r in body["items"]]


# 一覧


def test_lists_own_rooms(token: Callable[[str], str]) -> None:
    status, body = call("GET", "/rooms", token("member-1"))

    assert status == 200
    assert room_ids(body) == ["room-a"]
    room = body["items"][0]
    assert room["kind"] == "private"
    assert room["tenant_id"] == "t1"
    assert room["member_ids"] == ["member-1", "owner-1"]
    assert room["owner_ids"] == ["owner-1"]
    assert room["archived_at"] is None


def test_admin_lists_only_own_rooms_by_default(token: Callable[[str], str]) -> None:
    # 前は管理者にすべてを返していた。今は自分がメンバーのルームだけ
    assert call("GET", "/rooms", token("admin-1")) == (200, {"items": []})


def test_lists_joinable_public_rooms(token: Callable[[str], str]) -> None:
    status, body = call("GET", "/rooms", token("member-1"), scope="joinable")

    assert status == 200
    # 自分のテナントの Public だけ(t2 の room-q は出さない)
    assert room_ids(body) == ["room-p"]
    # 参加しているものは出さない
    assert call("GET", "/rooms", token("owner-1"), scope="joinable") == (200, {"items": []})


def test_joinable_skips_archived(token: Callable[[str], str]) -> None:
    store.update_room("room-p", archived_at=store.now())

    assert call("GET", "/rooms", token("member-1"), scope="joinable") == (200, {"items": []})


def test_admin_lists_tenant_rooms(token: Callable[[str], str]) -> None:
    status, body = call("GET", "/rooms", token("admin-1"), scope="tenant")

    assert status == 200
    assert room_ids(body) == ["room-a", "room-b", "room-p"]


def test_tenant_scope_requires_admin(token: Callable[[str], str]) -> None:
    assert call("GET", "/rooms", token("member-1"), scope="tenant")[0] == 403


def test_joinable_requires_tenant(token: Callable[[str], str]) -> None:
    assert call("GET", "/rooms", token("nobody"), scope="joinable")[0] == 403


def test_requires_token() -> None:
    assert call("GET", "/rooms", None)[0] == 401


def test_rejects_agent_token(make_token: Token) -> None:
    assert call("GET", "/rooms", make_token(scope="voice-intercom/agent"))[0] == 403


def test_member_list_skips_stale_index(
    token: Callable[[str], str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # GSI に外した後の行が残っていても(結果整合)、ルームのメンバーで確かめて出さない
    store.delete_member("room-a", "member-1")
    real_query = store._query  # pyright: ignore[reportPrivateUsage]

    def stale_query(table: Any, **kwargs: Any) -> Any:
        if kwargs.get("IndexName") == store.MEMBER_ROOMS_INDEX:
            return iter([{"room_id": "room-a", "user_id": "member-1"}])
        return real_query(table, **kwargs)

    monkeypatch.setattr(store, "_query", stale_query)

    assert call("GET", "/rooms", token("member-1")) == (200, {"items": []})


def test_member_list_skips_deleted_room(token: Callable[[str], str]) -> None:
    # ルームを消したときにメンバーの行が残っても(途中で失敗したとき)、一覧に出さない
    store._rooms().delete_item(Key={"room_id": "room-a"})  # pyright: ignore[reportPrivateUsage]

    assert call("GET", "/rooms", token("member-1")) == (200, {"items": []})


# 作成


def test_anyone_creates_room(token: Callable[[str], str]) -> None:
    status, body = call(
        "POST",
        "/rooms",
        token("member-1"),
        {"name": "C", "kind": "public", "member_ids": ["member-2", "member-2", "member-1"]},
    )

    assert status == 201
    assert len(body["room_id"]) == 12
    assert body["name"] == "C"
    assert body["kind"] == "public"
    assert body["tenant_id"] == "t1"
    # 作った人がオーナーになる
    assert body["member_ids"] == ["member-1", "member-2"]
    assert body["owner_ids"] == ["member-1"]
    assert body["created_at"] == body["updated_at"]
    assert call("GET", f"/rooms/{body['room_id']}", token("member-2")) == (200, body)


def test_create_rejects_other_tenant(token: Callable[[str], str]) -> None:
    status, _ = call(
        "POST",
        "/rooms",
        token("member-1"),
        {"name": "C", "kind": "private", "member_ids": ["outsider-1"]},
    )

    assert status == 400
    assert call("GET", "/rooms", token("member-1"))[1]["items"][0]["room_id"] == "room-a"


def test_create_rejects_unknown_user(token: Callable[[str], str]) -> None:
    body = {"name": "C", "kind": "private", "member_ids": ["ghost"]}

    assert call("POST", "/rooms", token("member-1"), body)[0] == 400


def test_create_requires_tenant(token: Callable[[str], str]) -> None:
    assert call("POST", "/rooms", token("nobody"), {"name": "C", "kind": "private"})[0] == 403


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"name": "", "kind": "private"}, id="empty-name"),
        pytest.param({"name": "x" * 101, "kind": "private"}, id="long-name"),
        pytest.param({"name": "C"}, id="no-kind"),
        # Connect は申請(POST /connect-requests)でしか作れない
        pytest.param({"name": "C", "kind": "connect"}, id="connect"),
    ],
)
def test_create_validates(token: Callable[[str], str], body: dict) -> None:
    assert call("POST", "/rooms", token("member-1"), body)[0] == 422


# 取得


def test_get_room(token: Callable[[str], str]) -> None:
    assert call("GET", "/rooms/room-a", token("member-1"))[0] == 200
    # 管理者はメンバーでなくても、ルームの設定は読める
    assert call("GET", "/rooms/room-a", token("admin-1"))[0] == 200
    # 参加する前に、同じテナントの Public は見られる
    assert call("GET", "/rooms/room-p", token("member-1"))[0] == 200


def test_get_room_forbidden(token: Callable[[str], str]) -> None:
    assert call("GET", "/rooms/room-a", token("member-2"))[0] == 403
    assert call("GET", "/rooms/room-p", token("outsider-1"))[0] == 403
    assert call("GET", "/rooms/room-a", token("admin-2"))[0] == 403


def test_get_unknown_room(token: Callable[[str], str]) -> None:
    assert call("GET", "/rooms/room-x", token("member-1"))[0] == 404


@pytest.mark.parametrize("room_id", ["a.b", "x" * 65])
def test_validates_room_id(token: Callable[[str], str], room_id: str) -> None:
    assert call("GET", f"/rooms/{room_id}", token("member-1"))[0] == 422


# 変更


def test_owner_updates_room(token: Callable[[str], str]) -> None:
    status, body = call(
        "PATCH", "/rooms/room-a", token("owner-1"), {"name": "A2", "kind": "public"}
    )

    assert status == 200
    assert body["name"] == "A2"
    assert body["kind"] == "public"
    assert body["updated_at"] >= body["created_at"]
    assert body["member_ids"] == ["member-1", "owner-1"]


def test_admin_updates_room(token: Callable[[str], str]) -> None:
    assert call("PATCH", "/rooms/room-b", token("admin-1"), {"name": "B2"})[1]["name"] == "B2"


def test_update_requires_owner(token: Callable[[str], str]) -> None:
    assert call("PATCH", "/rooms/room-a", token("member-1"), {"name": "A2"})[0] == 403
    # ほかのテナントの管理者は変えられない
    assert call("PATCH", "/rooms/room-a", token("admin-2"), {"name": "A2"})[0] == 403


def test_update_unknown_room(token: Callable[[str], str]) -> None:
    assert call("PATCH", "/rooms/room-x", token("admin-1"), {"name": "X"})[0] == 404


def test_connect_kind_cannot_change(token: Callable[[str], str]) -> None:
    store.create_room(
        "room-c", "C", tenant_id="t1", kind="connect", owner_ids=["owner-1"], connect_tenant_id="t2"
    )

    assert call("PATCH", "/rooms/room-c", token("owner-1"), {"kind": "public"})[0] == 400


# 参加する


def test_join_public_room(token: Callable[[str], str]) -> None:
    status, body = call("POST", "/rooms/room-p/join", token("member-1"))

    assert status == 200
    assert body["member_ids"] == ["member-1", "owner-1"]
    assert body["owner_ids"] == ["owner-1"]
    # 2回目は何もしない
    assert call("POST", "/rooms/room-p/join", token("member-1")) == (200, body)


def test_join_rejects_private_and_other_tenant(token: Callable[[str], str]) -> None:
    assert call("POST", "/rooms/room-b/join", token("member-1"))[0] == 403
    assert call("POST", "/rooms/room-p/join", token("outsider-1"))[0] == 403


def test_join_rejects_archived(token: Callable[[str], str]) -> None:
    store.update_room("room-p", archived_at=store.now())

    assert call("POST", "/rooms/room-p/join", token("member-1"))[0] == 409


# メンバー


def test_list_members(token: Callable[[str], str]) -> None:
    status, body = call("GET", "/rooms/room-a/members", token("member-1"))

    assert status == 200
    assert body["items"] == [
        {
            "user_id": "member-1",
            "role": "member",
            "tenant_id": "t1",
            "display_name": "member-1 さん",
        },
        {"user_id": "owner-1", "role": "owner", "tenant_id": "t1", "display_name": "owner-1 さん"},
    ]
    assert call("GET", "/rooms/room-a/members", token("admin-1"))[0] == 200
    assert call("GET", "/rooms/room-a/members", token("member-2"))[0] == 403


def test_owner_invites_member(token: Callable[[str], str]) -> None:
    status, body = call("PUT", "/rooms/room-a/members/member-2", token("owner-1"), {})

    assert status == 200
    # 承諾を待たずにメンバーになる
    assert body["member_ids"] == ["member-1", "member-2", "owner-1"]
    assert room_ids(call("GET", "/rooms", token("member-2"))[1]) == ["room-a", "room-b"]


def test_admin_invites_member(token: Callable[[str], str]) -> None:
    status, body = call("PUT", "/rooms/room-a/members/admin-1", token("admin-1"), {"role": "owner"})

    assert status == 200
    assert body["owner_ids"] == ["admin-1", "owner-1"]


def test_invite_requires_owner(token: Callable[[str], str]) -> None:
    assert call("PUT", "/rooms/room-a/members/member-2", token("member-1"), {})[0] == 403


def test_invite_rejects_other_tenant(token: Callable[[str], str]) -> None:
    assert call("PUT", "/rooms/room-a/members/outsider-1", token("owner-1"), {})[0] == 400
    assert call("PUT", "/rooms/room-a/members/nobody", token("owner-1"), {})[0] == 400


def test_owner_promotes_and_demotes(token: Callable[[str], str]) -> None:
    owner = token("owner-1")

    body = call("PUT", "/rooms/room-a/members/member-1", owner, {"role": "owner"})[1]
    assert body["owner_ids"] == ["member-1", "owner-1"]

    # オーナーが2人いれば、自分をメンバーに戻せる
    body = call("PUT", "/rooms/room-a/members/owner-1", owner, {"role": "member"})[1]
    assert body["owner_ids"] == ["member-1"]


def test_last_owner_cannot_be_demoted(token: Callable[[str], str]) -> None:
    status, body = call(
        "PUT", "/rooms/room-a/members/owner-1", token("admin-1"), {"role": "member"}
    )

    assert status == 409
    assert "最後のオーナー" in body["message"]


def test_member_leaves(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    status, body = call("DELETE", "/rooms/room-a/members/member-1", token("member-1"))

    assert (status, body) == (204, None)
    assert call("GET", "/rooms", token("member-1")) == (200, {"items": []})
    # LiveKit のルームにいれば出す
    assert cleanup.evicted == [("room-a", ["member-1"])]


def test_member_leaves_archived_room(token: Callable[[str], str]) -> None:
    store.update_room("room-a", archived_at=store.now())

    assert call("DELETE", "/rooms/room-a/members/member-1", token("member-1"))[0] == 204


def test_last_owner_cannot_leave(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    status, body = call("DELETE", "/rooms/room-a/members/owner-1", token("owner-1"))

    assert status == 409
    assert "アーカイブ" in body["message"]
    assert store.get_room("room-a").owner_ids == ["owner-1"]  # pyright: ignore[reportOptionalMemberAccess]
    # 管理者でも外せない
    assert call("DELETE", "/rooms/room-a/members/owner-1", token("admin-1"))[0] == 409
    assert cleanup.evicted == []


def test_owner_leaves_when_another_owner_remains(token: Callable[[str], str]) -> None:
    store.put_member("room-a", "member-1", role="owner", tenant_id="t1")

    assert call("DELETE", "/rooms/room-a/members/owner-1", token("owner-1"))[0] == 204


def test_owner_removes_member(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    assert call("DELETE", "/rooms/room-a/members/member-1", token("owner-1"))[0] == 204
    assert cleanup.evicted == [("room-a", ["member-1"])]


def test_remove_requires_owner(token: Callable[[str], str]) -> None:
    store.put_member("room-a", "member-2", role="member", tenant_id="t1")

    assert call("DELETE", "/rooms/room-a/members/member-2", token("member-1"))[0] == 403


def test_remove_non_member(token: Callable[[str], str]) -> None:
    assert call("DELETE", "/rooms/room-a/members/member-2", token("owner-1"))[0] == 404
    assert call("DELETE", "/rooms/room-a/members/member-2", token("member-2"))[0] == 404


# アーカイブ


def test_owner_archives_room(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    status, body = call("POST", "/rooms/room-a/archive", token("owner-1"))

    assert status == 200
    assert body["archived_at"] is not None
    # 全員を切る
    assert cleanup.closed == ["room-a"]
    # メンバーの一覧には残る(読むだけ)
    assert room_ids(call("GET", "/rooms", token("member-1"))[1]) == ["room-a"]

    status, body = call("DELETE", "/rooms/room-a/archive", token("owner-1"))

    assert status == 200
    assert body["archived_at"] is None


def test_archive_requires_owner(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    assert call("POST", "/rooms/room-a/archive", token("member-1"))[0] == 403
    assert call("POST", "/rooms/room-a/archive", token("admin-1"))[0] == 200
    assert call("DELETE", "/rooms/room-a/archive", token("member-1"))[0] == 403


# 音声


@pytest.fixture
def audio_calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, bool]]:
    calls: list[tuple[str, str, bool]] = []

    def set_audio(room_id: str, identity: str, enabled: bool) -> None:
        if identity == "member-2":
            raise participants.NotInRoomError(identity)
        calls.append((room_id, identity, enabled))

    monkeypatch.setattr(participants, "set_audio", set_audio)
    return calls


def test_set_audio(token: Callable[[str], str], audio_calls: list[tuple[str, str, bool]]) -> None:
    status, _ = call("PUT", "/rooms/room-a/audio", token("member-1"), {"enabled": True})

    assert status == 204
    assert audio_calls == [("room-a", "member-1", True)]


def test_set_audio_errors(
    token: Callable[[str], str], audio_calls: list[tuple[str, str, bool]]
) -> None:
    # LiveKit のルームにつないでいない
    assert call("PUT", "/rooms/room-b/audio", token("member-2"), {"enabled": True})[0] == 409
    assert call("PUT", "/rooms/room-b/audio", token("member-1"), {"enabled": True})[0] == 403
    store.update_room("room-a", archived_at=store.now())
    assert call("PUT", "/rooms/room-a/audio", token("member-1"), {"enabled": True})[0] == 409
    assert audio_calls == []


def test_archive_of_deleted_room(
    token: Callable[[str], str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def gone(room_id: str, **_values: object) -> None:
        raise store.NotFoundError(room_id)

    monkeypatch.setattr(store, "update_room", gone)

    assert call("POST", "/rooms/room-a/archive", token("owner-1"))[0] == 404


def test_unarchive_of_deleted_room(
    token: Callable[[str], str], monkeypatch: pytest.MonkeyPatch
) -> None:
    store.update_room("room-a", archived_at=store.now())

    def gone(room_id: str, **_values: object) -> None:
        raise store.NotFoundError(room_id)

    monkeypatch.setattr(store, "update_room", gone)

    assert call("DELETE", "/rooms/room-a/archive", token("owner-1"))[0] == 404


# 所属を変えたとき


def set_tenant(token: Callable[[str], str], user_id: str, tenant_id: str | None) -> int:
    return call("PUT", f"/users/{user_id}/tenant", token("operator-1"), {"tenant_id": tenant_id})[0]


def connect_room() -> None:
    store.create_room(
        "room-c", "C", tenant_id="t1", kind="connect", owner_ids=["owner-1"], connect_tenant_id="t2"
    )
    store.update_room("room-c", connect_status="active")
    store.put_member("room-c", "outsider-1", role="owner", tenant_id="t2")


def test_changing_tenant_removes_memberships(
    token: Callable[[str], str], cleanup: FakeCleanup
) -> None:
    assert set_tenant(token, "member-1", "t2") == 200

    assert store.tenant_of("member-1") == "t2"
    assert "member-1" not in store.get_room("room-a").member_ids  # pyright: ignore[reportOptionalMemberAccess]
    assert cleanup.evicted_from == [(["room-a"], "member-1")]


def test_removing_tenant_removes_memberships(
    token: Callable[[str], str], cleanup: FakeCleanup
) -> None:
    assert set_tenant(token, "member-1", None) == 200

    assert store.tenant_of("member-1") is None
    assert "member-1" not in store.get_room("room-a").member_ids  # pyright: ignore[reportOptionalMemberAccess]


def test_same_tenant_keeps_memberships(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    assert set_tenant(token, "member-1", "t1") == 200

    assert "member-1" in store.get_room("room-a").member_ids  # pyright: ignore[reportOptionalMemberAccess]
    assert cleanup.evicted_from == [([], "member-1")]


def test_last_owner_is_removed_and_admin_takes_over(
    token: Callable[[str], str],
) -> None:
    assert set_tenant(token, "owner-1", "t2") == 200

    room = store.get_room("room-a")
    assert room is not None
    assert room.owner_ids == []
    # オーナーの居ないルームは、テナントの管理者が扱う
    assert (
        call("PUT", "/rooms/room-a/members/member-1", token("admin-1"), {"role": "owner"})[0] == 200
    )


def test_connect_removes_only_own_side(token: Callable[[str], str]) -> None:
    connect_room()

    assert set_tenant(token, "owner-1", None) == 200

    room = store.get_room("room-c")
    assert room is not None
    assert room.member_ids == ["outsider-1"]
    assert room.owner_ids == ["outsider-1"]


def test_moving_to_connect_partner_removes_member(token: Callable[[str], str]) -> None:
    # 相手のテナントへ移っても、元の側のメンバーのままにはしない
    connect_room()

    assert set_tenant(token, "owner-1", "t2") == 200

    assert store.get_room("room-c").member_ids == ["outsider-1"]  # pyright: ignore[reportOptionalMemberAccess]


def test_evict_failure_keeps_row_for_retry(
    token: Callable[[str], str], cleanup: FakeCleanup
) -> None:
    cleanup.evict_failures = {"room-a"}

    assert set_tenant(token, "member-1", "t2") == 503
    # 所属の変更は効いていて、外せなかったルームも使えない
    assert store.tenant_of("member-1") == "t2"
    assert "member-1" in store.get_room("room-a").member_ids  # pyright: ignore[reportOptionalMemberAccess]
    assert call("GET", "/rooms/room-a", token("member-1"))[0] == 403

    cleanup.evict_failures = set()
    assert set_tenant(token, "member-1", "t2") == 200
    assert "member-1" not in store.get_room("room-a").member_ids  # pyright: ignore[reportOptionalMemberAccess]


def test_stale_row_gives_no_access(token: Callable[[str], str]) -> None:
    # 所属の変更だけが効いて、メンバーの行が残っている(前からあるデータも同じ)
    store.set_user_tenant("member-1", "t2")

    member = token("member-1")
    assert call("GET", "/rooms", member)[1]["items"] == []
    assert call("GET", "/rooms/room-a", member)[0] == 403
    assert call("GET", "/rooms/room-a/members", member)[0] == 403
    # 所属の無い人も同じ
    store.set_user_tenant("member-1", None)
    assert call("GET", "/rooms", member)[1]["items"] == []
    assert call("GET", "/rooms/room-a", member)[0] == 403


def test_stale_owner_of_connect_cannot_manage(token: Callable[[str], str]) -> None:
    connect_room()
    store.set_user_tenant("owner-1", "t2")

    assert call("PATCH", "/rooms/room-c", token("owner-1"), {"name": "D"})[0] == 403


# 削除


def test_admin_deletes_room(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    status, body = call("DELETE", "/rooms/room-a", token("admin-1"))

    assert (status, body) == (204, None)
    assert store.get_room("room-a") is None
    assert store.members_of("room-a") == []
    assert cleanup.deleted == ["room-a"]


def test_delete_requires_admin_of_room_tenant(
    token: Callable[[str], str], cleanup: FakeCleanup
) -> None:
    # オーナーでも消せない(アーカイブする)
    assert call("DELETE", "/rooms/room-a", token("owner-1"))[0] == 403
    assert call("DELETE", "/rooms/room-a", token("admin-2"))[0] == 403
    assert store.get_room("room-a") is not None
    assert cleanup.deleted == []


def test_delete_unknown_room(token: Callable[[str], str], cleanup: FakeCleanup) -> None:
    assert call("DELETE", "/rooms/room-x", token("admin-1"))[0] == 404
    # 行が無いルームの後始末は、どのテナントのものか確かめられないので行わない
    assert cleanup.deleted == []


def test_unfinished_delete_can_be_retried(
    token: Callable[[str], str], cleanup: FakeCleanup
) -> None:
    cleanup.purge_finishes = False

    assert call("DELETE", "/rooms/room-p", token("admin-1"))[0] == 503

    # 行は残るが、メンバーやテナントの人からは、もう無いルームに見える
    room = store.get_room("room-p")
    assert room is not None and room.deleting_at is not None
    assert call("GET", "/rooms/room-p", token("owner-1"))[0] == 404
    assert call("POST", "/rooms/room-p/join", token("member-1"))[0] == 404
    ids = [r["room_id"] for r in call("GET", "/rooms", token("owner-1"))[1]["items"]]
    assert "room-p" not in ids
    joinable = call("GET", "/rooms", token("member-1"), scope="joinable")[1]["items"]
    assert joinable == []
    # 管理者には見え、やり直せる
    assert call("GET", "/rooms/room-p", token("admin-1"))[0] == 200
    listed = call("GET", "/rooms", token("admin-1"), scope="tenant")[1]["items"]
    assert [r["deleting_at"] is not None for r in listed if r["room_id"] == "room-p"] == [True]

    # ほかのテナントの管理者は、やり直せない
    assert call("DELETE", "/rooms/room-p", token("admin-2"))[0] == 403
    assert cleanup.deleted == ["room-p"]

    cleanup.purge_finishes = True
    assert call("DELETE", "/rooms/room-p", token("admin-1"))[0] == 204
    assert store.get_room("room-p") is None
    assert store.members_of("room-p") == []
    assert call("DELETE", "/rooms/room-p", token("admin-1"))[0] == 404


# 前のデータを移す


def test_migrate_member_ids(token: Callable[[str], str]) -> None:
    # room_members に移す前の形の行(member_ids を rooms の行に持つ)
    store._rooms().put_item(  # pyright: ignore[reportPrivateUsage]
        Item={
            "room_id": "room-old",
            "name": "Old",
            "tenant_id": "t1",
            "member_ids": ["member-1", "member-9", "member-1"],
            "created_at": "2026-10-01T00:00:00.000Z",
            "updated_at": "2026-10-01T00:00:00.000Z",
        }
    )

    migrate_room_members.main()
    migrate_room_members.main()  # 2回目は何もしない

    item = store._rooms().get_item(Key={"room_id": "room-old"})["Item"]  # pyright: ignore[reportPrivateUsage]
    assert "member_ids" not in item
    status, body = call("GET", "/rooms", token("member-1"))
    assert status == 200
    assert room_ids(body) == ["room-a", "room-old"]
    assert body["items"][1]["member_ids"] == ["member-1", "member-9"]


def test_migrate_tenants(token: Callable[[str], str]) -> None:
    # テナントを入れる前の形の行(ルームに tenant_id と kind が無く、メンバーの行に role が無い)
    store._rooms().put_item(  # pyright: ignore[reportPrivateUsage]
        Item={
            "room_id": "room-old",
            "name": "Old",
            "created_at": "2026-10-01T00:00:00.000Z",
            "updated_at": "2026-10-01T00:00:00.000Z",
        }
    )
    store._members().put_item(Item={"room_id": "room-old", "user_id": "old-user"})  # pyright: ignore[reportPrivateUsage]
    store.put_user("old-user", display_name="前の人", language="ja")

    migrate_tenants.migrate("t9", "前のテナント")
    migrate_tenants.migrate("t9", "前のテナント")  # 2回目は何もしない

    assert store.get_tenant("t9").name == "前のテナント"  # pyright: ignore[reportOptionalMemberAccess]
    assert store.tenant_of("old-user") == "t9"
    # 所属のある人は変えない
    assert store.tenant_of("member-1") == "t1"
    room = store.get_room("room-old")
    assert room is not None
    assert (room.tenant_id, room.kind, room.owner_ids) == ("t9", "private", [])
    assert store.members_of("room-old") == [
        store.Member(user_id="old-user", role="member", tenant_id="t9")
    ]
    # 移した前のルームは、そのテナントの管理者が管理する
    assert store.get_room("room-a").tenant_id == "t1"  # pyright: ignore[reportOptionalMemberAccess]


def test_get_room_reads_consistently(monkeypatch: pytest.MonkeyPatch) -> None:
    # 無い・アーカイブしたという判定が、LiveKit のルームを閉じる判断につながる
    reads: list[dict[str, Any]] = []
    table = store._rooms()  # pyright: ignore[reportPrivateUsage]

    class Spy:
        def get_item(self, **kwargs: Any) -> Any:
            reads.append(kwargs)
            return table.get_item(**kwargs)

    monkeypatch.setattr(store, "_rooms", Spy)

    store.get_room("room-none")

    assert reads == [{"Key": {"room_id": "room-none"}, "ConsistentRead": True}]
