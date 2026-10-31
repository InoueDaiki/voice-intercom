// 標準の OIDC(認可コード + PKCE)でログインする。本番は Cognito、ローカルは模擬 OIDC。
import { LoginRequiredError, RenewalRetry } from "@voice-intercom/client-core/auth";
import { ErrorResponse, type User, UserManager, type UserManagerSettings, WebStorageStateStore } from "oidc-client-ts";
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
    // ログアウトでリフレッシュトークンを取り消す。Cognito の取り消しはリフレッシュトークンだけを受ける
    // (アクセストークンも送ると断られ、ログアウトまで止まる)
    revokeTokensOnSignout: true,
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

// 自動更新が通信の失敗で止まったら、やり直す
function watchRenewal(manager: AppUserManager): RenewalRetry {
  const retry = new RenewalRetry({
    renew: async () => {
      const user = await manager.getUser();
      if (!user?.refresh_token) {
        throw new LoginRequiredError();
      }
      await manager.signinSilent();
    },
    // 認可サーバーがエラーで答えた(リフレッシュトークンの失効など)。通信の失敗は別の型になる
    isRefused: (e) => e instanceof ErrorResponse,
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
  try {
    await redirectToLogout(manager);
  } catch (e) {
    // トークンを取り消せなくても(通信の失敗、取り消しの窓口が無いなど)、ログアウトは止めない
    console.warn("トークンを取り消せないままログアウトする", e);
    try {
      await redirectToLogout(new UserManager({ ...settings(), revokeTokensOnSignout: false, automaticSilentRenew: false }));
    } catch (logoutError) {
      // ログアウトの画面に行けなくても、この端末からはログインを消す
      console.warn("ログアウトの画面に移れなかった", logoutError);
      await manager.removeUser();
    }
  }
}

// API の呼び出しに付けるアクセストークン
export async function getAccessToken(): Promise<string> {
  const user = await getUserManager().getUser();
  if (!user || user.expired) {
    throw new LoginRequiredError();
  }
  return user.access_token;
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
