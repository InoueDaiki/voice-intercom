// 管理 API のモック。サーバーがなくても画面を確かめられるよう、メモリ上のデータで応答する。
// 開発サーバーで VITE_API_MOCK=1 のときだけ読み込む(adminApi.ts)。データは再読み込みで初期値に戻る。
// ログインしている人は、テナント acme の管理者(user 1)として振る舞う。
//
// エラーの表示を確かめるための特別な ID:
//   - ルーム `forbidden`: 一覧には出るが、詳細を開くと 403
//   - 名前 `network-error` で作成: 通信の失敗
//   - 最後のオーナーを外す・メンバーに戻す: 409、ない ID を開く: 404
//   - ルーム `half-deleted`: 削除の途中(deleting_at)。DELETE は1回目が 503、2回目で消える
//   - ルーム `delete-503`(「削除が止まるルーム」): 1回目の DELETE が 503 で、削除の途中になる

import {
  type AdminApi,
  ApiError,
  type ConnectRequest,
  type MemberRole,
  type Room,
  type RoomMember,
  type Tenant,
  type User,
} from "./adminApi.ts";

const now = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const MY_TENANT = "acme";

const tenants: Tenant[] = [
  { tenant_id: "acme", name: "ACME 物流", created_at: hoursAgo(500) },
  { tenant_id: "partner", name: "協力会社", created_at: hoursAgo(400) },
];

const users: User[] = [
  { user_id: "11111111-aaaa-4000-8000-000000000001", display_name: "山田 太郎", language: "ja", tenant_id: "acme" },
  { user_id: "11111111-aaaa-4000-8000-000000000002", display_name: "Maria Silva", language: "pt", tenant_id: "acme" },
  { user_id: "11111111-aaaa-4000-8000-000000000003", display_name: "Nguyen Van An", language: "vi", tenant_id: "acme" },
  { user_id: "11111111-aaaa-4000-8000-000000000004", display_name: "Carlos García", language: "es", tenant_id: "acme" },
  { user_id: "11111111-aaaa-4000-8000-000000000005", display_name: "王 伟", language: "zh", tenant_id: "partner" },
  { user_id: "11111111-aaaa-4000-8000-000000000006", display_name: "John Smith", language: "en", tenant_id: "partner" },
  // 所属の無いユーザー(運営者が所属を決める)
  { user_id: "11111111-aaaa-4000-8000-000000000007", display_name: "Kim Minji", language: "ko", tenant_id: null },
].map((u, i) => ({
  ...u,
  language: u.language as User["language"],
  created_at: hoursAgo(240 - i * 20),
  updated_at: hoursAgo(200 - i * 20),
}));

const me = users[0]!.user_id;

// ルームの行と、メンバー(user_id → 役割とテナント)
interface MockRoom {
  room: Omit<Room, "member_ids" | "owner_ids">;
  members: Map<string, { role: MemberRole; tenant_id: string }>;
}

const member = (i: number, role: MemberRole = "member") =>
  [users[i]!.user_id, { role, tenant_id: users[i]!.tenant_id ?? "" }] as const;

const rooms = new Map<string, MockRoom>(
  [
    {
      room: {
        room_id: "warehouse-a",
        name: "A 倉庫",
        kind: "private" as const,
        tenant_id: MY_TENANT,
        created_at: hoursAgo(72),
        updated_at: hoursAgo(3),
      },
      members: new Map([member(0, "owner"), member(1), member(2)]),
    },
    {
      room: {
        room_id: "all-hands",
        name: "全体連絡",
        kind: "public" as const,
        tenant_id: MY_TENANT,
        created_at: hoursAgo(48),
        updated_at: hoursAgo(30),
      },
      // ユーザー一覧にいない sub(退職などで消えたユーザー)の表示を確かめる
      members: new Map([member(3, "owner"), ["99999999-dead-4000-8000-000000000000", { role: "member", tenant_id: MY_TENANT }]]),
    },
    {
      room: {
        room_id: "joint",
        name: "協力会社と合同",
        kind: "connect" as const,
        tenant_id: MY_TENANT,
        connect_tenant_id: "partner",
        connect_status: "active" as const,
        created_at: hoursAgo(20),
        updated_at: hoursAgo(10),
      },
      members: new Map([member(0, "owner"), member(4, "owner"), member(5)]),
    },
    {
      room: {
        room_id: "old",
        name: "前の現場",
        kind: "private" as const,
        tenant_id: MY_TENANT,
        archived_at: hoursAgo(100),
        created_at: hoursAgo(300),
        updated_at: hoursAgo(100),
      },
      members: new Map([member(0, "owner")]),
    },
    {
      room: {
        room_id: "incoming",
        name: "協力会社からの申請",
        kind: "connect" as const,
        tenant_id: "partner",
        connect_tenant_id: MY_TENANT,
        connect_status: "pending" as const,
        created_at: hoursAgo(2),
        updated_at: hoursAgo(2),
      },
      members: new Map([member(4, "owner")]),
    },
    {
      room: {
        room_id: "forbidden",
        name: "見られないルーム(403)",
        kind: "private" as const,
        tenant_id: MY_TENANT,
        created_at: hoursAgo(5),
        updated_at: hoursAgo(5),
      },
      members: new Map(),
    },
    {
      room: {
        room_id: "half-deleted",
        name: "削除の途中のルーム",
        kind: "private" as const,
        tenant_id: MY_TENANT,
        deleting_at: hoursAgo(1),
        created_at: hoursAgo(90),
        updated_at: hoursAgo(1),
      },
      members: new Map([member(0, "owner"), member(1)]),
    },
    {
      room: {
        room_id: "delete-503",
        name: "削除が止まるルーム",
        kind: "private" as const,
        tenant_id: MY_TENANT,
        created_at: hoursAgo(80),
        updated_at: hoursAgo(8),
      },
      members: new Map([member(0, "owner")]),
    },
  ].map((r) => [r.room.room_id, r as MockRoom]),
);

// 通信の遅れを真似る
const delay = () => new Promise((resolve) => setTimeout(resolve, 300));
// 呼び出し側がデータを書き換えてもモックの中身が変わらないよう、写しを返す
const copy = <T>(value: T): T => structuredClone(value);

function toRoom({ room, members }: MockRoom): Room {
  const ids = [...members.keys()].sort();
  return copy({
    ...room,
    member_ids: ids,
    owner_ids: ids.filter((id) => members.get(id)?.role === "owner"),
  });
}

// DELETE が止まる残りの回数(room_id → 回数)
const incompleteDeletes = new Map([
  ["half-deleted", 1],
  ["delete-503", 1],
]);

// ルームを返す。削除の途中のルームも返す(GET /rooms/{id} と DELETE だけが扱う)
function findIncludingDeleting(roomId: string): MockRoom {
  if (roomId === "forbidden") {
    throw new ApiError(403, "このルームを見る権限がありません");
  }
  const room = rooms.get(roomId);
  if (!room) {
    throw new ApiError(404, "ルームがない");
  }
  return room;
}

function find(roomId: string): MockRoom {
  const room = findIncludingDeleting(roomId);
  if (room.room.deleting_at) {
    throw new ApiError(404, "ルームがない");
  }
  return room;
}

function isLastOwner(r: MockRoom, userId: string): boolean {
  const owners = [...r.members].filter(([, m]) => m.role === "owner");
  return owners.length === 1 && owners[0]![0] === userId;
}

function toRequest(r: MockRoom): ConnectRequest {
  const name = (id: string | null | undefined) => tenants.find((t) => t.tenant_id === id)?.name ?? id ?? "";
  return {
    room: toRoom(r),
    direction: r.room.tenant_id === MY_TENANT ? "outgoing" : "incoming",
    from_tenant_name: name(r.room.tenant_id),
    to_tenant_name: name(r.room.connect_tenant_id),
  };
}

let nextId = 1;

export const mockAdminApi: AdminApi = {
  async getMe() {
    await delay();
    return copy(users[0]!);
  },
  async listRooms() {
    await delay();
    return { items: [...rooms.values()].map(toRoom) };
  },
  async getRoom(roomId) {
    await delay();
    return toRoom(findIncludingDeleting(roomId));
  },
  async createRoom(body) {
    await delay();
    if (body.name === "network-error") {
      throw new ApiError(0);
    }
    const r: MockRoom = {
      room: { room_id: `mock${nextId++}`, name: body.name, kind: body.kind, tenant_id: MY_TENANT, created_at: now(), updated_at: now() },
      members: new Map([[me, { role: "owner", tenant_id: MY_TENANT }]]),
    };
    for (const id of body.member_ids ?? []) {
      if (id !== me) {
        r.members.set(id, { role: "member", tenant_id: MY_TENANT });
      }
    }
    rooms.set(r.room.room_id, r);
    return toRoom(r);
  },
  async updateRoom(roomId, body) {
    await delay();
    const r = find(roomId);
    Object.assign(r.room, Object.fromEntries(Object.entries(body).filter(([, v]) => v != null)), { updated_at: now() });
    return toRoom(r);
  },
  async deleteRoom(roomId) {
    await delay();
    const r = findIncludingDeleting(roomId);
    r.room.deleting_at ??= now();
    const left = incompleteDeletes.get(roomId) ?? 0;
    if (left > 0) {
      incompleteDeletes.set(roomId, left - 1);
      throw new ApiError(503, "後始末が途中で止まった。同じ DELETE をやり直す");
    }
    rooms.delete(roomId);
  },
  async archiveRoom(roomId) {
    await delay();
    const r = find(roomId);
    r.room.archived_at ??= now();
    return toRoom(r);
  },
  async unarchiveRoom(roomId) {
    await delay();
    const r = find(roomId);
    delete r.room.archived_at;
    return toRoom(r);
  },
  async listRoomMembers(roomId) {
    await delay();
    const r = find(roomId);
    const items: RoomMember[] = [...r.members]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([user_id, m]) => ({ user_id, ...m, display_name: users.find((u) => u.user_id === user_id)?.display_name ?? null }));
    return { items };
  },
  async putRoomMember(roomId, userId, role) {
    await delay();
    const r = find(roomId);
    if (role === "member" && isLastOwner(r, userId)) {
      throw new ApiError(409, "最後のオーナーは抜けられない(ほかの人をオーナーにするか、アーカイブする)");
    }
    r.members.set(userId, { role, tenant_id: r.members.get(userId)?.tenant_id ?? MY_TENANT });
    return toRoom(r);
  },
  async deleteRoomMember(roomId, userId) {
    await delay();
    const r = find(roomId);
    if (isLastOwner(r, userId)) {
      throw new ApiError(409, "最後のオーナーは抜けられない(ほかの人をオーナーにするか、アーカイブする)");
    }
    r.members.delete(userId);
  },
  // 本物は、管理者には自分のテナントの人だけを返す。モックは運営者の画面も確かめるため、すべてを返す
  async listUsers() {
    await delay();
    return { items: copy(users) };
  },
  async listConnectRequests() {
    await delay();
    return { items: [...rooms.values()].filter((r) => r.room.connect_status === "pending").map(toRequest) };
  },
  async createConnectRequest(body) {
    await delay();
    if (!tenants.some((t) => t.tenant_id === body.tenant_id)) {
      throw new ApiError(404, "相手のテナントがない");
    }
    if (body.tenant_id === MY_TENANT) {
      throw new ApiError(400, "自分のテナントには申請できない");
    }
    const r: MockRoom = {
      room: {
        room_id: `mock${nextId++}`,
        name: body.name,
        kind: "connect",
        tenant_id: MY_TENANT,
        connect_tenant_id: body.tenant_id,
        connect_status: "pending",
        created_at: now(),
        updated_at: now(),
      },
      members: new Map([[me, { role: "owner", tenant_id: MY_TENANT }]]),
    };
    rooms.set(r.room.room_id, r);
    return toRequest(r);
  },
  async acceptConnectRequest(roomId) {
    await delay();
    const r = find(roomId);
    r.room.connect_status = "active";
    r.members.set(me, { role: "owner", tenant_id: MY_TENANT });
    return toRoom(r);
  },
  async deleteConnectRequest(roomId) {
    await delay();
    find(roomId);
    rooms.delete(roomId);
  },
  async listTenants() {
    await delay();
    return { items: copy(tenants) };
  },
  async createTenant(body) {
    await delay();
    if (tenants.some((t) => t.tenant_id === body.tenant_id)) {
      throw new ApiError(409, "同じ tenant_id のテナントが既にある");
    }
    const tenant = { ...body, created_at: now() };
    tenants.push(tenant);
    return copy(tenant);
  },
  async setUserTenant(userId, tenantId) {
    await delay();
    const user = users.find((u) => u.user_id === userId);
    if (!user) {
      throw new ApiError(404, "プロフィールを登録したユーザーがない");
    }
    user.tenant_id = tenantId;
    user.updated_at = now();
    return copy(user);
  },
};
