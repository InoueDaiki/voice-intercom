// 管理 API(ルーム、ユーザー、履歴)の呼び出し。画面はここに置いた関数だけを使う。
// 型は生成クライアント(@voice-intercom/api-client)から取る(履歴だけは、型が入るまでこのファイルに一時的に置く)。

import type { Schemas } from "@voice-intercom/api-client";

import { api } from "./api.ts";
import { getAccessToken } from "./auth.ts";
import { config } from "./config.ts";

// ---- 型 ----

export type Room = Schemas["Room"];
export type User = Schemas["User"];
export type RoomCreate = Schemas["CreateRoomRequest"];
export type RoomUpdate = Schemas["UpdateRoomRequest"];
export type Language = User["language"];

export interface ListResponse<T> {
  items: T[];
}

// ---- ルームの履歴(一時的な型) ----
// TODO(生成クライアント): 履歴の API(GET /rooms/{room_id}/timeline)が openapi.json に入ったら、
// 次の4つの型を消して `Schemas["TimelineEvent"]` などに置き換える(名前は生成物に合わせる)。
// 形はサーバーの担当と決めたもの。

// 履歴の1件の種類。utterance は音声の発話(長い発話は区切られて複数件になる)、text はテキスト入力、media は画像・動画
export type TimelineKind = "utterance" | "text" | "media";

export interface TimelineMedia {
  media_id: string;
  content_type: string;
  // 本体と縮小画像の URL(CloudFront)
  url: string;
  thumbnail_url: string | null;
  size_bytes: number;
}

export interface TimelineEvent {
  room_id: string;
  // `<occurred_at>#<source_id>`。並びとページングのキー
  event_id: string;
  kind: TimelineKind;
  // 送信者の Cognito の sub
  sender_id: string;
  occurred_at: string;
  // 原文の言語。わからないときは null
  language: string | null;
  text: string;
  // 言語コード → 訳文
  translations: Record<string, string>;
  // utterance のとき。同じ発話の区切りは utterance_id が同じで、segment_index で順番がわかる
  utterance_id?: string | null;
  segment_index?: number | null;
  media: TimelineMedia | null;
}

// 新しい順。next_before が null なら、それより古いものはない
export interface TimelinePage {
  items: TimelineEvent[];
  next_before: string | null;
}

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

// TODO(生成クライアント): 履歴の API が生成クライアントに入ったら、この関数を消して、httpAdminApi.listTimeline を
//   call(api.GET("/rooms/{room_id}/timeline", { params: { path: { room_id: roomId }, query } }))
// にする。それまでは openapi-fetch が型の無いパスを呼べないので、素の fetch とアクセストークンで呼ぶ
async function fetchTimeline(roomId: string, query: TimelineQuery = {}): Promise<TimelinePage> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.before !== undefined) {
    params.set("before", query.before);
  }
  const base = config.apiBaseUrl.replace(/\/+$/, "");
  const qs = params.size > 0 ? `?${params}` : "";
  const token = await getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${base}/rooms/${encodeURIComponent(roomId)}/timeline${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, detailOf(body));
  }
  return body as TimelinePage;
}

const httpAdminApi: AdminApi = {
  listRooms: () => call(api.GET("/rooms")),
  getRoom: (roomId) => call(api.GET("/rooms/{room_id}", path(roomId))),
  createRoom: (body) => call(api.POST("/rooms", { body })),
  updateRoom: (roomId, body) => call(api.PATCH("/rooms/{room_id}", { ...path(roomId), body })),
  deleteRoom: async (roomId) => {
    await call(api.DELETE("/rooms/{room_id}", path(roomId)));
  },
  listUsers: () => call(api.GET("/users")),
  listTimeline: fetchTimeline,
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
