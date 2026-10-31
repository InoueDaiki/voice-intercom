// ログインの状態の扱いのうち、OIDC のライブラリにも画面にも依らないところ。
// 管理コンソールからも使うので、このファイルは livekit-client を読み込むものに依らない
// (package.json の exports の ./auth)
import { Observable } from "../observable.ts";

// アクセストークンを渡せない(ログインしていない、期限が切れている)。通信の失敗とは分けて見せる。
// 各アプリの getAccessToken が投げ、API の呼び出しはそのまま通す
export class LoginRequiredError extends Error {
  constructor() {
    super("ログインが切れています。ログインし直してください。");
    this.name = "LoginRequiredError";
  }
}

// 認可サーバーがリフレッシュトークンを断ったか(失効、取り消し。やり直しても通らない)。
// OIDC のライブラリの誤り(ErrorResponse)は error に OAuth のエラーコードを持つ。
// 通信の失敗や、一時的なエラーのコード(server_error など)は、ログインを保ってやり直す
export function isInvalidGrant(error: unknown): boolean {
  return typeof error === "object" && error !== null && "error" in error && error.error === "invalid_grant";
}

// 期限までに終わらなければ投げる。もとの処理は止めない(結果は捨てる)。応答の無い相手を待ち続けないためのもの
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${ms}ミリ秒待っても終わらなかった`)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export interface RenewalRetryOptions {
  // トークンの更新を1回試す
  renew: () => Promise<void>;
  // サーバーが断った(やり直しても通らない)失敗か
  isRefused: (error: unknown) => boolean;
  // やり直すまでの間隔(ミリ秒)。最後の値で続ける
  delaysMs?: readonly number[];
}

// 通信の失敗で止まったトークンの更新をやり直す。oidc-client-ts の自動更新は、タイムアウトのほかは
// 失敗を知らせるだけで、期限まで次を試さない(電波が切れた間に期限が来ると、戻っても更新されない)
export class RenewalRetry extends Observable {
  // やり直している途中か。この間はログインが切れたとはみなさない
  retrying = false;

  private readonly renew: () => Promise<void>;
  private readonly isRefused: (error: unknown) => boolean;
  private readonly delaysMs: readonly number[];
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private disposed = false;
  private readonly recoveredListeners = new Set<() => void>();

  constructor(options: RenewalRetryOptions) {
    super();
    this.renew = options.renew;
    this.isRefused = options.isRefused;
    this.delaysMs = options.delaysMs ?? [5_000, 15_000, 30_000, 60_000];
  }

  // 更新に失敗した
  failed(error: unknown): void {
    if (this.disposed) {
      return;
    }
    if (error instanceof LoginRequiredError || this.isRefused(error)) {
      this.stop();
      return;
    }
    if (!this.retrying) {
      this.retrying = true;
      this.changed();
    }
    this.clearTimer();
    const delay = this.delaysMs[Math.min(this.attempt, this.delaysMs.length - 1)] ?? 60_000;
    this.attempt++;
    this.timer = setTimeout(() => void this.run(), delay);
  }

  // 更新できた
  succeeded(): void {
    const recovered = this.retrying;
    this.stop();
    if (recovered) {
      for (const listener of [...this.recoveredListeners]) {
        listener();
      }
    }
  }

  // やり直しの末に更新できたら呼ぶ(トークンを取れずに止まっていた処理を動かす)。
  // 更新が戻るたびに1回だけなので、呼ばれた先の失敗では繰り返さない。解除する関数を返す
  subscribeRecovered(listener: () => void): () => void {
    this.recoveredListeners.add(listener);
    return () => this.recoveredListeners.delete(listener);
  }

  // すぐ試す(ネットワークが戻った、画面に戻った)。やり直している途中でなければ何もしない
  wake(): void {
    if (this.retrying && !this.running && !this.disposed) {
      this.clearTimer();
      void this.run();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      await this.renew();
      this.running = false;
      this.succeeded();
    } catch (e) {
      this.running = false;
      this.failed(e);
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private stop(): void {
    this.clearTimer();
    this.attempt = 0;
    if (this.retrying) {
      this.retrying = false;
      this.changed();
    }
  }
}

// 保存したログイン情報(oidc-client-ts の User の JSON)の利用者。読めなければ undefined
export function storedUserSub(stored: string | null | undefined): string | undefined {
  if (!stored) {
    return undefined;
  }
  try {
    const sub: unknown = (JSON.parse(stored) as { profile?: { sub?: unknown } }).profile?.sub;
    return typeof sub === "string" ? sub : undefined;
  } catch {
    return undefined;
  }
}

// 別のタブが保存したログイン情報が、この画面の利用者にとって何を意味するか。
// - signedOut: ログアウトした
// - switched: 別の人でログインし直した
// - updated: 同じ人のトークンが新しくなった、またはログインした(読み直せば使える)
export type StoredUserChange = "signedOut" | "switched" | "updated";

export function storedUserChange(currentSub: string | undefined, stored: string | null): StoredUserChange {
  if (stored === null) {
    return currentSub === undefined ? "updated" : "signedOut";
  }
  const sub = storedUserSub(stored);
  return currentSub !== undefined && sub !== undefined && sub !== currentSub ? "switched" : "updated";
}
