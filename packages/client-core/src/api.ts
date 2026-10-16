// 利用者向けの REST API の呼び出し。生成したクライアント(@voice-intercom/api-client)に、
// 呼ぶたびにアクセストークンを付ける(トークンの取り方は各アプリが渡す)。

import { createApiClient, type Schemas } from "@voice-intercom/api-client";

// ---- 型 ----

export type Room = Schemas["Room"];
export type User = Schemas["User"];
export type Language = User["language"];
export type LiveKitToken = Schemas["LiveKitTokenResponse"];
// utterance は音声の発話、text はテキスト入力、media は画像・動画
export type TimelineEvent = Schemas["TimelineEvent"];
export type TimelineMedia = Schemas["TimelineMedia"];
export type TimelinePage = Schemas["TimelinePage"];
export type MediaUpload = Schemas["MediaUpload"];
export type UploadPartUrls = Schemas["UploadPartUrls"];
export type CompletedPart = Schemas["CompletedPart"];
export type CreateMediaUploadRequest = Schemas["CreateMediaUploadRequest"];
export type MediaContentType = CreateMediaUploadRequest["content_type"];

// 話者の言語(services/api の定義と同じ並び。gpt-realtime-translate の出力言語)
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

export const LANGUAGE_LABELS: Record<Language, string> = {
  es: "スペイン語",
  pt: "ポルトガル語",
  fr: "フランス語",
  ja: "日本語",
  ru: "ロシア語",
  zh: "中国語",
  de: "ドイツ語",
  ko: "韓国語",
  hi: "ヒンディー語",
  id: "インドネシア語",
  vi: "ベトナム語",
  it: "イタリア語",
  en: "英語",
};

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
// Powertools の `{ statusCode, message }` と、検証エラーの `{ detail: string }` を見る
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

type FetchResult<T> = Promise<{ data?: T; error?: unknown; response: { ok: boolean; status: number } }>;

// openapi-fetch の結果を、成功なら data に、失敗なら ApiError に直す
async function call<T>(result: FetchResult<T>): Promise<T> {
  let r: Awaited<FetchResult<T>>;
  try {
    r = await result;
  } catch {
    throw new ApiError(0);
  }
  if (!r.response.ok) {
    throw new ApiError(r.response.status, detailOf(r.error));
  }
  return r.data as T;
}

// 404 なら null にする
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return null;
    }
    throw e;
  }
}

// ---- 呼び出しの口 ----

export interface ClientApiOptions {
  baseUrl: string;
  // 呼び出しのたびにアクセストークンを返す(更新はアプリ側の OIDC クライアントに任せる)
  getAccessToken: () => Promise<string>;
}

export type ClientApi = ReturnType<typeof createClientApi>;

export function createClientApi(options: ClientApiOptions) {
  const api = createApiClient(options);
  const room = (room_id: string) => ({ params: { path: { room_id } } });
  const media = (room_id: string, media_id: string) => ({ params: { path: { room_id, media_id } } });
  const event = (room_id: string, event_id: string) => ({
    params: { path: { room_id }, query: { event_id } },
  });

  return {
    // 自分のプロフィール。未登録なら null
    getMyProfile: () => orNull(call(api.GET("/users/me"))),
    putMyProfile: (display_name: string, language: Language) =>
      call(api.PUT("/users/me", { body: { display_name, language } })),

    listRooms: async () => (await call(api.GET("/rooms"))).items,
    getRoom: (roomId: string) => call(api.GET("/rooms/{room_id}", room(roomId))),

    // LiveKit の参加用トークン。プロフィールが未登録なら 409 の ApiError
    createLiveKitToken: (roomId: string) => call(api.POST("/livekit/token", { body: { room_name: roomId } })),

    // 履歴を新しい順に。before は前の応答の next_before
    listTimeline: (roomId: string, query: { limit?: number; before?: string } = {}) =>
      call(api.GET("/rooms/{room_id}/timeline", { params: { path: { room_id: roomId }, query } })),
    // 履歴の1件(強い整合の読み取り)。無ければ null。消した行は deleted が付く
    getTimelineEvent: (roomId: string, eventId: string) =>
      orNull(call(api.GET("/rooms/{room_id}/timeline/event", event(roomId, eventId)))),
    // 自分の送ったテキスト入力か画像・動画を消し、墓石(deleted の付いた行)を返す。
    // 2回目も同じ墓石を返す。他人のものや音声の発話は 403
    deleteTimelineEvent: (roomId: string, eventId: string) =>
      call(api.DELETE("/rooms/{room_id}/timeline/event", event(roomId, eventId))),

    // 画像・動画を PUT する署名付き URL
    createMediaUpload: (roomId: string, body: CreateMediaUploadRequest) =>
      call(api.POST("/rooms/{room_id}/media/uploads", { ...room(roomId), body })),
    // マルチパートのパート(と、thumbnail ならサムネイル)を PUT する署名付き URL
    createUploadPartUrls: (roomId: string, mediaId: string, partNumbers: number[], thumbnail = false) =>
      call(
        api.POST("/rooms/{room_id}/media/{media_id}/parts", {
          ...media(roomId, mediaId),
          body: { part_numbers: partNumbers, thumbnail },
        }),
      ),
    // アップロードした画像・動画を履歴に保存する。2回目からは同じ履歴を返す。
    // マルチパートなら parts に全パートの番号と ETag を渡す
    completeMediaUpload: (roomId: string, mediaId: string, parts?: CompletedPart[]) =>
      call(
        api.POST("/rooms/{room_id}/media/{media_id}/complete", {
          ...media(roomId, mediaId),
          ...(parts && { body: { parts } }),
        }),
      ),
  };
}
