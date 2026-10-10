// 管理 API(ルームとユーザー)の呼び出し。画面はここに置いた関数だけを使う。
//
// TODO(生成クライアントへの差し替え): services/api にルームとユーザーの API が入り、
// `mise run gen` で packages/api-client/ts に型が出たら、次を直す。
//   1. 下の「一時的な型」を消し、`Schemas`(@voice-intercom/api-client)から取る。
//      例: `export type Room = Schemas["Room"];`(名前は Pydantic のモデル名に合わせる)
//   2. httpAdminApi の各関数の request() を、api.ts の `api.GET("/rooms")` などに置き換える。
//      openapi-fetch は失敗を `{ error, response }` で返すので、toApiError() で ApiError に直す。
//   3. request() と、その中の fetch / getAccessToken の呼び出しを消す。
// 画面(pages/)と queries.ts は AdminApi の形だけに依存しているので、直さなくてよい。

import { getAccessToken } from "./auth.ts";
import { config } from "./config.ts";

// ---- 一時的な型(TODO: 生成した型に置き換える) ----

// 話者の言語(services/api の定義と同じ並び)
export const LANGUAGES = ["es", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface Room {
  room_id: string;
  name: string;
  // メンバーの Cognito の sub
  member_ids: string[];
  // ISO 8601
  created_at: string;
  updated_at: string;
}

export interface User {
  // Cognito の sub
  user_id: string;
  display_name: string;
  language: Language;
  created_at: string;
  updated_at: string;
}

export interface RoomCreate {
  room_id: string;
  name: string;
  member_ids?: string[];
}

export interface RoomUpdate {
  name?: string;
  member_ids?: string[];
}

export interface ListResponse<T> {
  items: T[];
}

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

// FastAPI のエラーの本文 `{ detail: string | ValidationError[] }` から、文字列の detail だけを取り出す
async function toApiError(response: Response): Promise<ApiError> {
  let detail: string | undefined;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
      detail = body.detail;
    }
  } catch {
    // 本文が JSON でなければ detail なし
  }
  return new ApiError(response.status, detail);
}

// ---- 呼び出しの口 ----

// 画面から使う操作。本物(HTTP)とモックのどちらもこの形を満たす
export interface AdminApi {
  listRooms(): Promise<ListResponse<Room>>;
  getRoom(roomId: string): Promise<Room>;
  createRoom(body: RoomCreate): Promise<Room>;
  updateRoom(roomId: string, body: RoomUpdate): Promise<Room>;
  deleteRoom(roomId: string): Promise<void>;
  listUsers(): Promise<ListResponse<User>>;
}

// TODO(生成クライアントへの差し替え): api.ts の `api`(openapi-fetch)に置き換えたら消す
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0);
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

// TODO(生成クライアントへの差し替え): 各関数を `api.GET("/rooms/{room_id}", { params: { path: { room_id } } })`
// のような呼び出しに置き換える
const httpAdminApi: AdminApi = {
  listRooms: () => request("GET", "/rooms"),
  getRoom: (roomId) => request("GET", `/rooms/${enc(roomId)}`),
  createRoom: (body) => request("POST", "/rooms", body),
  updateRoom: (roomId, body) => request("PATCH", `/rooms/${enc(roomId)}`, body),
  deleteRoom: (roomId) => request("DELETE", `/rooms/${enc(roomId)}`),
  listUsers: () => request("GET", "/users"),
};

// 開発サーバーで VITE_API_MOCK=1 のときだけ、メモリ上のモックで応答する。
// 本番のビルドでは import.meta.env.DEV が false に置き換わり、モックの import ごと取り除かれる
export const isMock = import.meta.env.DEV && import.meta.env.VITE_API_MOCK === "1";

let impl: Promise<AdminApi> | undefined;
function load(): Promise<AdminApi> {
  impl ??= isMock ? import("./mockAdminApi.ts").then((m) => m.mockAdminApi) : Promise.resolve(httpAdminApi);
  return impl;
}

export const adminApi: AdminApi = {
  listRooms: async () => (await load()).listRooms(),
  getRoom: async (roomId) => (await load()).getRoom(roomId),
  createRoom: async (body) => (await load()).createRoom(body),
  updateRoom: async (roomId, body) => (await load()).updateRoom(roomId, body),
  deleteRoom: async (roomId) => (await load()).deleteRoom(roomId),
  listUsers: async () => (await load()).listUsers(),
};
