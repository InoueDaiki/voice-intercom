// ルームの画面で共通に使う、入力の検査と表示の整形
import { ApiError, type Language } from "./adminApi.ts";

// services/api の Room と同じ制約
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const ROOM_NAME_MAX = 100;

export function validateRoomId(roomId: string): string | undefined {
  if (roomId === "") {
    return "ルーム ID を入力してください";
  }
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return "ルーム ID は半角英数字と - _ だけで、64文字以内にしてください";
  }
  return undefined;
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

// 言語コードを日本語名に直す。知らないコードはそのまま、null は「不明」
export function languageLabel(code: string | null | undefined): string {
  if (!code) {
    return "不明";
  }
  return code in LANGUAGE_LABELS ? LANGUAGE_LABELS[code as Language] : code;
}

const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

// 履歴の時刻。発話の前後がわかるよう、秒まで出す
const timeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "medium" });

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : timeFormat.format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// API の失敗を、画面に出す文に直す。409 は画面ごとに文が違うので、呼び出し側で先に見る
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
      return "このルームを扱う権限がありません。";
    case 404:
      return "ルームが見つかりません。削除された可能性があります。";
    case 409:
      return "同じ ID のルームが既にあります。";
    case 422:
      return `入力が正しくありません${error.detail ? `(${error.detail})` : ""}。`;
    default:
      return `サーバーでエラーが起きました(${error.status})。時間をおいて、もう一度試してください。`;
  }
}
