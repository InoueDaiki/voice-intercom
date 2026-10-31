// 誤りの文言と、取得の再試行の決め方
import { ApiError, NotSavedYetError } from "@voice-intercom/client-core";

// 403 / 404 は再試行しても変わらないので、すぐに表示する
export function retry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

// 読み直しても変わらない失敗(無いもの、権限が無いもの)。持っている値があっても表示を続けない
export function isPermanentError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return error.detail === "テナントに所属していない"
        ? "テナントに所属していません。運営者に所属を決めてもらってください。"
        : "このルームに入る権限がありません。";
    }
    if (error.status === 409 && error.detail) {
      return error.detail;
    }
    if (error.status === 404) {
      return "見つかりません。";
    }
    return error.detail ? `${error.message}: ${error.detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

// ルームにつなげなかった理由の文言
export function joinErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) {
    return e.detail === "プロフィールをまだ登録していない"
      ? "プロフィールが登録されていないので、つなげません。"
      : `つなげませんでした: ${e.detail ?? e.message}`;
  }
  return `つなげませんでした: ${errorMessage(e)}`;
}

// タイムラインの行を消せなかった理由の文言
export function deleteErrorMessage(e: unknown): string {
  return e instanceof NotSavedYetError ? "まだ履歴に保存されていません。少し待ってからやり直してください。" : errorMessage(e);
}
