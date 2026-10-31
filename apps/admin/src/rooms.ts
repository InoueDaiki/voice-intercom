// ルームの画面で共通に使う、入力の検査と表示の整形
import { ApiError, type Language, type Room, type RoomKind } from "./adminApi.ts";

// services/api の Room と同じ制約
export const ROOM_NAME_MAX = 100;

// ルームの種別(設計メモの「テナントとルームの種別」)
export const ROOM_KIND_LABELS: Record<RoomKind, { label: string; description: string }> = {
  public: { label: "Public", description: "テナントの誰でも参加できる" },
  private: { label: "Private", description: "オーナーか管理者が招待した人だけが入れる" },
  connect: { label: "Connect", description: "ほかのテナントの人と一緒に使う。招待した人だけが入れる" },
};

// 一覧に出す状態。削除の途中、申請中の Connect、アーカイブしたルームだけ札を付ける
export function roomState(room: Room): "deleting" | "pending" | "archived" | undefined {
  if (room.deleting_at) {
    return "deleting";
  }
  if (room.connect_status === "pending") {
    return "pending";
  }
  return room.archived_at ? "archived" : undefined;
}

export function validateRoomName(name: string): string | undefined {
  if (name.trim() === "") {
    return "名前を入力してください";
  }
  // サーバーの文字数(Python の len)に合わせ、UTF-16 ではなくコードポイントで数える
  if ([...name].length > ROOM_NAME_MAX) {
    return `名前は${ROOM_NAME_MAX}文字以内にしてください`;
  }
  return undefined;
}

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

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

// 503 は失敗ではなく、途中まで進んだという応答(DELETE /rooms/{id}、PUT /users/{id}/tenant)。
// 同じ操作をやり直すと続きを行う
export function isIncomplete(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 503;
}

export const DELETE_INCOMPLETE_MESSAGE = "途中まで削除しました。もう一度「削除を続ける」を押してください。";

// API の失敗を、画面に出す文に直す
export function errorMessage(error: Error): string {
  if (!(error instanceof ApiError)) {
    return error.message;
  }
  switch (error.status) {
    case 0:
      return "通信に失敗しました。ネットワークの状態を確かめて、もう一度試してください。";
    case 401:
      return "ログインの期限が切れました。ページを読み込み直してください。";
    case 403:
      // 管理者もテナントに所属していないと使えない(Web 版でプロフィールを登録し、運営者に所属を決めてもらう)
      return error.detail === "テナントに所属していない"
        ? "テナントに所属していません。Web 版でプロフィールを登録し、運営者に所属を決めてもらってください。"
        : "この操作をする権限がありません。";
    case 404:
      return "ルームが見つかりません。削除された可能性があります。";
    case 400:
    case 409:
      // 最後のオーナー、申請中、ほかのテナントの人など。サーバーの文をそのまま出す
      return error.detail ?? "この操作はできません。";
    case 422:
      return `入力が正しくありません${error.detail ? `(${error.detail})` : ""}。`;
    default:
      return `サーバーでエラーが起きました(${error.status})。時間をおいて、もう一度試してください。`;
  }
}
