// 管理 API(ルーム、ユーザー、履歴)の呼び出し。画面はここに置いた関数だけを使う。
// 型は生成クライアント(@voice-intercom/api-client)から取る。

import type { Schemas } from "@voice-intercom/api-client";

import { api } from "./api.ts";

// ---- 型 ----

export type Room = Schemas["Room"];
export type User = Schemas["User"];
export type RoomCreate = Schemas["CreateRoomRequest"];
export type RoomUpdate = Schemas["UpdateRoomRequest"];
export type Language = User["language"];

export interface ListResponse<T> {
  items: T[];
}

// ---- ルームの履歴 ----

// utterance は音声の発話(長い発話は区切られて複数件になる)、text はテキスト入力、media は画像・動画
export type TimelineEvent = Schemas["TimelineEvent"];
export type TimelineKind = TimelineEvent["kind"];
export type TimelineMedia = Schemas["TimelineMedia"];
// 新しい順。next_before が null なら、それより古いものはない
export type TimelinePage = Schemas["TimelinePage"];

export interface TimelineQuery {
  limit?: number;
  // この event_id より古いものを返す
  before?: string;
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
  listRooms(): Promise<ListResponse<Room>>;
  getRoom(roomId: string): Promise<Room>;
  createRoom(body: RoomCreate): Promise<Room>;
  updateRoom(roomId: string, body: RoomUpdate): Promise<Room>;
  deleteRoom(roomId: string): Promise<void>;
  listUsers(): Promise<ListResponse<User>>;
  listTimeline(roomId: string, query?: TimelineQuery): Promise<TimelinePage>;
}

const path = (room_id: string) => ({ params: { path: { room_id } } });

const httpAdminApi: AdminApi = {
  listRooms: () => call(api.GET("/rooms")),
  getRoom: (roomId) => call(api.GET("/rooms/{room_id}", path(roomId))),
  createRoom: (body) => call(api.POST("/rooms", { body })),
  updateRoom: (roomId, body) => call(api.PATCH("/rooms/{room_id}", { ...path(roomId), body })),
  deleteRoom: async (roomId) => {
    await call(api.DELETE("/rooms/{room_id}", path(roomId)));
  },
  listUsers: () => call(api.GET("/users")),
  listTimeline: (roomId, query) =>
    call(api.GET("/rooms/{room_id}/timeline", { params: { path: { room_id: roomId }, query } })),
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
  listTimeline: async (roomId, query) => (await load()).listTimeline(roomId, query),
};
