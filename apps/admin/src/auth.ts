// 標準の OIDC(認可コード + PKCE)でログインする。本番は Cognito、ローカルは模擬 OIDC。
import { isInvalidGrant, LoginRequiredError, RenewalRetry, withDeadline } from "@voice-intercom/client-core/auth";
import { type User, UserManager, type UserManagerSettings, WebStorageStateStore } from "oidc-client-ts";
import { useEffect, useReducer, useSyncExternalStore } from "react";
import type { AuthContextProps } from "react-oidc-context";

import { config } from "./config.ts";

// 管理コンソールを使えるグループ(infra/modules/cognito の aws_cognito_user_group)。
// テナントの管理者(自分のテナントのルーム・ユーザー・Connect の申請を扱う)
export const ADMIN_GROUP = "admin";
// 運営者(テナントを作り、ユーザーの所属を決める)
export const OPERATOR_GROUP = "operator";

// ログアウトの後に、通信中だったトークンの更新の応答で、ログインが戻らないようにする
class AppUserManager extends UserManager {
  // ログアウトを始めたか。この後はログイン情報を保存しない
  closing = false;

  override async storeUser(user: User | null): Promise<void> {
    if (user && this.closing) {
      return;
    }
    await super.storeUser(user);
  }

  // 自動更新とやり直しを止める。ログアウトの前に呼ぶ
  close(): void {
    this.closing = true;
    this.stopSilentRenew();
    renewalRetry?.dispose();
  }
}

function settings(): UserManagerSettings {
  return {
    authority: config.oidcIssuer,
    client_id: config.oidcClientId,
    redirect_uri: `${window.location.origin}/callback`,
    post_logout_redirect_uri: window.location.origin,
    response_type: "code",
    scope: "openid email profile",
    // タブを閉じたらログインし直す(Cognito の管理コンソールのリフレッシュトークンも1日と短くしている)
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    // アクセストークンの期限が近づいたら、リフレッシュトークンで更新する
    automaticSilentRenew: true,
    // ログアウトで取り消すのはリフレッシュトークンだけ(signOut)。Cognito の取り消しはリフレッシュトークンだけを
    // 受ける(アクセストークンも送ると断られる)
    revokeTokenTypes: ["refresh_token"],
    // Cognito のログイン画面を日本語で出す(lang が無いと英語)。管理コンソールの画面が日本語なので揃える
    extraQueryParams: { lang: "ja" },
    ...(config.oidcLogoutUrl && {
      metadataSeed: {
        end_session_endpoint: config.oidcLogoutUrl,
        // 探索の応答に無くても取り消せるようにする
        revocation_endpoint: config.oidcLogoutUrl.replace(/\/logout$/, "/oauth2/revoke"),
      },
    }),
  };
}

// ビルドのとき(SPA の index.html を作るとき)は Node で読み込まれ window が無いので、
// 最初に使うときに作る
let userManager: AppUserManager | undefined;
let renewalRetry: RenewalRetry | undefined;
export function getUserManager(): AppUserManager {
  if (!userManager) {
    const manager = new AppUserManager(settings());
    userManager = manager;
    renewalRetry = watchRenewal(manager);
  }
  return userManager;
}

// 応答の無い相手を待つ長さ。signinSilent も取り消しも、引数なしでは通信に期限が付かない。
// requestTimeoutInSeconds はログインのコードの交換や探索にも効き、応答の本文の遅れや探索との合計には
// 効かないので、処理の全体をここで区切る
const RENEW_DEADLINE_MS = 10_000;
const REVOKE_DEADLINE_MS = 5_000;

// リフレッシュトークンでトークンを更新する。同時に呼ばれたら1回にまとめる
let renewing: Promise<User | null> | undefined;
function renewNow(manager: UserManager): Promise<User | null> {
  renewing ??= withDeadline(manager.signinSilent(), RENEW_DEADLINE_MS).finally(() => {
    renewing = undefined;
  });
  return renewing;
}

// 自動更新が通信の失敗で止まったら、やり直す
function watchRenewal(manager: AppUserManager): RenewalRetry {
  const retry = new RenewalRetry({
    renew: async () => {
      const user = await manager.getUser();
      if (!user?.refresh_token) {
        throw new LoginRequiredError();
      }
      await renewNow(manager);
    },
    isRefused: isInvalidGrant,
  });
  manager.events.addSilentRenewError((e) => retry.failed(e));
  manager.events.addUserLoaded(() => retry.succeeded());
  // 裏のタブのタイマーは遅れるので、戻ったらすぐ試す
  window.addEventListener("online", () => retry.wake());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      retry.wake();
    }
  });
  return retry;
}

async function redirectToLogout(manager: UserManager): Promise<void> {
  if (config.oidcLogoutUrl) {
    // Cognito の /logout は client_id と logout_uri を受け取る
    await manager.signoutRedirect({
      extraQueryParams: { client_id: config.oidcClientId, logout_uri: window.location.origin },
    });
  } else {
    await manager.signoutRedirect();
  }
}

export async function signOut(): Promise<void> {
  const manager = getUserManager();
  // 更新の通信中でも、この後にログインが戻らないようにする
  manager.close();
  // トークンを取り消せなくても(通信の失敗、応答が無い、取り消しの窓口が無いなど)、ログアウトは止めない
  try {
    await withDeadline(manager.revokeTokens(), REVOKE_DEADLINE_MS);
  } catch (e) {
    console.warn("トークンを取り消せないままログアウトする", e);
  }
  try {
    await redirectToLogout(manager);
  } catch (logoutError) {
    // ログアウトの画面に行けなくても、この端末からはログインを消す
    console.warn("ログアウトの画面に移れなかった", logoutError);
    await manager.removeUser();
    // ログアウトを始めた印は残るので、読み直してログインの流れに戻す
    window.location.reload();
  }
}

// ログアウトの途中か。ログアウトの画面へ移る間にログインが消えても、認可の画面へ送らない
export function isSigningOut(): boolean {
  return getUserManager().closing;
}

// 保存したリフレッシュトークンでログインを戻す(期限切れのまま開き直したとき)。戻せたら true。
// 戻せなければ、認可の画面へ送る
export async function restoreLogin(): Promise<boolean> {
  const manager = getUserManager();
  const user = await manager.getUser();
  if (!user?.refresh_token) {
    return false;
  }
  try {
    const renewed = await renewNow(manager);
    return renewed != null && !renewed.expired;
  } catch (e) {
    console.info("リフレッシュトークンでログインを戻せなかった", e);
    return false;
  }
}

// API の呼び出しに付けるアクセストークン。期限が切れていても、更新できるなら更新を待つ
// (スリープから戻った直後は、自動更新より先に呼ばれる)
export async function getAccessToken(): Promise<string> {
  const manager = getUserManager();
  const user = await manager.getUser();
  if (user && !user.expired) {
    return user.access_token;
  }
  if (!user?.refresh_token || manager.closing) {
    throw new LoginRequiredError();
  }
  try {
    const renewed = await renewNow(manager);
    if (renewed && !renewed.expired && !manager.closing) {
      return renewed.access_token;
    }
  } catch (e) {
    // 自動更新の失敗と同じに扱う: 断られたらログインし直してもらい、通信の失敗ならやり直す
    await manager.events._raiseSilentRenewError(e instanceof Error ? e : new Error(String(e)));
    if (!isInvalidGrant(e)) {
      throw e; // ログインは切れていない
    }
  }
  throw new LoginRequiredError();
}

// ログインが本当に切れたか。自動更新に失敗しても、トークンが有効な間と、通信の失敗からやり直している間は
// false(画面を保つ)。切れていれば、ログインし直してもらう
export function useLoginLost(auth: AuthContextProps): boolean {
  const manager = getUserManager();
  const retry = renewalRetry;
  const retrying = useSyncExternalStore(
    (listener) => retry?.subscribe(listener) ?? (() => {}),
    () => retry?.retrying ?? false,
  );
  // 期限が来たら描き直す(auth は期限では変わらない)
  const [, expired] = useReducer((n: number) => n + 1, 0);
  useEffect(() => manager.events.addAccessTokenExpired(expired), [manager]);
  const hasValidToken = auth.user != null && !auth.user.expired;
  return auth.error !== undefined && !hasValidToken && !retrying;
}

// アクセストークンの cognito:groups。API もアクセストークンで権限を判定するので、それに揃える。
// 表示の出し分けに使うだけで、署名は確かめない(検証は API がする)
export function groupsOf(user: User): string[] {
  try {
    const payload = user.access_token.split(".")[1] ?? "";
    const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const groups: unknown = JSON.parse(json)["cognito:groups"];
    return Array.isArray(groups) ? groups.filter((g) => typeof g === "string") : [];
  } catch {
    return [];
  }
}
