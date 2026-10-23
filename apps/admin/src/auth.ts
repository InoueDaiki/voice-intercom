// 標準の OIDC(認可コード + PKCE)でログインする。本番は Cognito、ローカルは模擬 OIDC。
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

import { config } from "./config.ts";

// 管理コンソールを使えるグループ(infra/modules/cognito の aws_cognito_user_group)。
// テナントの管理者(自分のテナントのルーム・ユーザー・Connect の申請を扱う)
export const ADMIN_GROUP = "admin";
// 運営者(テナントを作り、ユーザーの所属を決める)
export const OPERATOR_GROUP = "operator";

// ビルドのとき(SPA の index.html を作るとき)は Node で読み込まれ window が無いので、
// 最初に使うときに作る
let userManager: UserManager | undefined;
export function getUserManager(): UserManager {
  userManager ??= new UserManager({
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
    // Cognito のログイン画面を日本語で出す(lang が無いと英語)。管理コンソールの画面が日本語なので揃える
    extraQueryParams: { lang: "ja" },
    ...(config.oidcLogoutUrl && {
      metadataSeed: { end_session_endpoint: config.oidcLogoutUrl },
    }),
  });
  return userManager;
}

export async function signOut(): Promise<void> {
  if (config.oidcLogoutUrl) {
    // Cognito の /logout は client_id と logout_uri を受け取る
    await getUserManager().signoutRedirect({
      extraQueryParams: { client_id: config.oidcClientId, logout_uri: window.location.origin },
    });
  } else {
    await getUserManager().signoutRedirect();
  }
}

// API の呼び出しに付けるアクセストークン
export async function getAccessToken(): Promise<string> {
  const user = await getUserManager().getUser();
  if (!user || user.expired) {
    throw new Error("ログインしていない");
  }
  return user.access_token;
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
