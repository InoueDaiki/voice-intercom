// 管理 API のモック。サーバーがなくても画面を確かめられるよう、メモリ上のデータで応答する。
// 開発サーバーで VITE_API_MOCK=1 のときだけ読み込む(adminApi.ts)。データは再読み込みで初期値に戻る。
//
// エラーの表示を確かめるための特別な ID:
//   - ルーム `forbidden`: 一覧には出るが、詳細を開くと 403
//   - ルーム ID `network-error` で作成: 通信の失敗
//   - 既にある ID で作成: 409、ない ID を開く: 404

import { ApiError, type AdminApi, type Room, type User } from "./adminApi.ts";

const now = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const users: User[] = [
  { user_id: "11111111-aaaa-4000-8000-000000000001", display_name: "山田 太郎", language: "ja" },
  { user_id: "11111111-aaaa-4000-8000-000000000002", display_name: "Maria Silva", language: "pt" },
  { user_id: "11111111-aaaa-4000-8000-000000000003", display_name: "Nguyen Van An", language: "vi" },
  { user_id: "11111111-aaaa-4000-8000-000000000004", display_name: "Carlos García", language: "es" },
  { user_id: "11111111-aaaa-4000-8000-000000000005", display_name: "王 伟", language: "zh" },
  { user_id: "11111111-aaaa-4000-8000-000000000006", display_name: "John Smith", language: "en" },
].map((u) => ({ ...u, language: u.language as User["language"], created_at: hoursAgo(240), updated_at: hoursAgo(240) }));

const rooms = new Map<string, Room>(
  [
    {
      room_id: "warehouse-a",
      name: "A 倉庫",
      member_ids: [users[0]!.user_id, users[1]!.user_id, users[2]!.user_id],
      created_at: hoursAgo(72),
      updated_at: hoursAgo(3),
    },
    {
      room_id: "line_2",
      name: "第2ライン",
      // ユーザー一覧にいない sub(退職などで消えたユーザー)の表示を確かめる
      member_ids: [users[3]!.user_id, "99999999-dead-4000-8000-000000000000"],
      created_at: hoursAgo(48),
      updated_at: hoursAgo(30),
    },
    { room_id: "forbidden", name: "見られないルーム(403)", member_ids: [], created_at: hoursAgo(5), updated_at: hoursAgo(5) },
  ].map((r) => [r.room_id, r]),
);

// 通信の遅れを真似る
const delay = () => new Promise((resolve) => setTimeout(resolve, 300));
// 呼び出し側がデータを書き換えてもモックの中身が変わらないよう、写しを返す
const copy = <T>(value: T): T => structuredClone(value);

function find(roomId: string): Room {
  if (roomId === "forbidden") {
    throw new ApiError(403, "このルームを見る権限がありません");
  }
  const room = rooms.get(roomId);
  if (!room) {
    throw new ApiError(404, "Room not found");
  }
  return room;
}

export const mockAdminApi: AdminApi = {
  async listRooms() {
    await delay();
    return { items: copy([...rooms.values()]) };
  },
  async getRoom(roomId) {
    await delay();
    return copy(find(roomId));
  },
  async createRoom(body) {
    await delay();
    if (body.room_id === "network-error") {
      throw new ApiError(0);
    }
    if (rooms.has(body.room_id)) {
      throw new ApiError(409, "Room already exists");
    }
    const room: Room = { ...body, member_ids: body.member_ids ?? [], created_at: now(), updated_at: now() };
    rooms.set(room.room_id, room);
    return copy(room);
  },
  async updateRoom(roomId, body) {
    await delay();
    const room = find(roomId);
    Object.assign(room, body, { updated_at: now() });
    return copy(room);
  },
  async deleteRoom(roomId) {
    await delay();
    find(roomId);
    rooms.delete(roomId);
  },
  async listUsers() {
    await delay();
    return { items: copy(users) };
  },
};
