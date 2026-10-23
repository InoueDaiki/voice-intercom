// 管理 API(ルーム、ユーザー)の呼び出し。画面はここに置いた関数だけを使う。
// 型は生成クライアント(@voice-intercom/api-client)から取る。

import type { Schemas } from "@voice-intercom/api-client";

import { api } from "./api.ts";

// ---- 型 ----

export type Room = Schemas["Room"];
export type RoomKind = Room["kind"];
export type RoomMember = Schemas["RoomMember"];
export type MemberRole = RoomMember["role"];
export type User = Schemas["User"];
export type Tenant = Schemas["Tenant"];
export type ConnectRequest = Schemas["ConnectRequest"];
export type RoomCreate = Schemas["CreateRoomRequest"];
export type RoomUpdate = Schemas["UpdateRoomRequest"];
export type ConnectRequestCreate = Schemas["CreateConnectRequest"];
export type TenantCreate = Schemas["CreateTenantRequest"];
export type Language = User["language"];

export interface ListResponse<T> {
  items: T[];
}

// 話者の言語(services/api の定義と同じ並び)。型は生成物と突き合わせる
export const LANGUAGES = [
  "es",
  "pt",
  "fr",
  "ja",
  "ru",
  "zh",
  "de",
  "ko",
  "hi",
  "id",
  "vi",
  "it",
  "en",
] as const satisfies readonly Language[];

// ---- エラー ----

// API の失敗。status が 0 のときは通信そのものの失敗(サーバーに届かない、CORS など)
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(status: number, detail?: string) {
    super(status === 0 ? "通信に失敗しました" : `API がエラーを返しました(${status})`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

// エラーの本文から、人が読める文言を取り出す。
// Powertools の `{ statusCode, message }`(ErrorResponse)と、検証エラーの `{ detail: string }` を見る
function detailOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  if ("message" in body && typeof body.message === "string") {
    return body.message;
  }
  if ("detail" in body && typeof body.detail === "string") {
    return body.detail;
  }
  return undefined;
}

// openapi-fetch の結果を、成功なら data に、失敗なら ApiError に直す
async function call<T>(result: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let r: Awaited<typeof result>;
  try {
    r = await result;
  } catch {
    throw new ApiError(0);
  }
  if (!r.response.ok) {
    throw new ApiError(r.response.status, detailOf(r.error));
  }
  // 204 では data が undefined になる(deleteRoom の戻り値は void)
  return r.data as T;
}

// ---- 呼び出しの口 ----

// 画面から使う操作。本物(HTTP)とモックのどちらもこの形を満たす
export interface AdminApi {
  // 自分のプロフィール(所属するテナント)。未登録なら null
  getMe(): Promise<User | null>;
  // 自分のテナントに関わるルーム(申請中の Connect も)
  listRooms(): Promise<ListResponse<Room>>;
  getRoom(roomId: string): Promise<Room>;
  // 作った管理者がオーナーになる
  createRoom(body: RoomCreate): Promise<Room>;
  updateRoom(roomId: string, body: RoomUpdate): Promise<Room>;
  deleteRoom(roomId: string): Promise<void>;
  archiveRoom(roomId: string): Promise<Room>;
  unarchiveRoom(roomId: string): Promise<Room>;
  listRoomMembers(roomId: string): Promise<ListResponse<RoomMember>>;
  putRoomMember(roomId: string, userId: string, role: MemberRole): Promise<Room>;
  deleteRoomMember(roomId: string, userId: string): Promise<void>;
  // 管理者には自分のテナントの人、運営者にはすべての人
  listUsers(): Promise<ListResponse<User>>;
  listConnectRequests(): Promise<ListResponse<ConnectRequest>>;
  createConnectRequest(body: ConnectRequestCreate): Promise<ConnectRequest>;
  acceptConnectRequest(roomId: string): Promise<Room>;
  deleteConnectRequest(roomId: string): Promise<void>;
  // 運営者
  listTenants(): Promise<ListResponse<Tenant>>;
  createTenant(body: TenantCreate): Promise<Tenant>;
  setUserTenant(userId: string, tenantId: string | null): Promise<User>;
}

const path = (room_id: string) => ({ params: { path: { room_id } } });
const memberPath = (room_id: string, user_id: string) => ({ params: { path: { room_id, user_id } } });

const httpAdminApi: AdminApi = {
  getMe: async () => {
    try {
      return await call(api.GET("/users/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        return null;
      }
      throw e;
    }
  },
  listRooms: () => call(api.GET("/rooms", { params: { query: { scope: "tenant" } } })),
  getRoom: (roomId) => call(api.GET("/rooms/{room_id}", path(roomId))),
  createRoom: (body) => call(api.POST("/rooms", { body })),
  updateRoom: (roomId, body) => call(api.PATCH("/rooms/{room_id}", { ...path(roomId), body })),
  deleteRoom: async (roomId) => {
    await call(api.DELETE("/rooms/{room_id}", path(roomId)));
  },
  archiveRoom: (roomId) => call(api.POST("/rooms/{room_id}/archive", path(roomId))),
  unarchiveRoom: (roomId) => call(api.DELETE("/rooms/{room_id}/archive", path(roomId))),
  listRoomMembers: (roomId) => call(api.GET("/rooms/{room_id}/members", path(roomId))),
  putRoomMember: (roomId, userId, role) =>
    call(api.PUT("/rooms/{room_id}/members/{user_id}", { ...memberPath(roomId, userId), body: { role } })),
  deleteRoomMember: async (roomId, userId) => {
    await call(api.DELETE("/rooms/{room_id}/members/{user_id}", memberPath(roomId, userId)));
  },
  listUsers: () => call(api.GET("/users")),
  listConnectRequests: () => call(api.GET("/connect-requests")),
  createConnectRequest: (body) => call(api.POST("/connect-requests", { body })),
  acceptConnectRequest: (roomId) => call(api.POST("/connect-requests/{room_id}/accept", path(roomId))),
  deleteConnectRequest: async (roomId) => {
    await call(api.DELETE("/connect-requests/{room_id}", path(roomId)));
  },
  listTenants: () => call(api.GET("/tenants")),
  createTenant: (body) => call(api.POST("/tenants", { body })),
  setUserTenant: (userId, tenantId) =>
    call(api.PUT("/users/{user_id}/tenant", { params: { path: { user_id: userId } }, body: { tenant_id: tenantId } })),
};

// 開発サーバーで VITE_API_MOCK=1 のときだけ、メモリ上のモックで応答する。
// 本番のビルドでは import.meta.env.DEV が false に置き換わり、モックの import ごと取り除かれる
export const isMock = import.meta.env.DEV && import.meta.env.VITE_API_MOCK === "1";

let impl: Promise<AdminApi> | undefined;
function load(): Promise<AdminApi> {
  impl ??= isMock ? import("./mockAdminApi.ts").then((m) => m.mockAdminApi) : Promise.resolve(httpAdminApi);
  return impl;
}

// 呼ぶときに、本物かモックを読み込んでから同じ名前の操作を呼ぶ
export const adminApi = new Proxy({} as AdminApi, {
  get:
    (_target, name: keyof AdminApi) =>
    async (...args: unknown[]) =>
      ((await load())[name] as (...a: unknown[]) => Promise<unknown>)(...args),
});
