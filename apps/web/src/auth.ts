// 標準の OIDC(認可コード + PKCE)でログインする。本番は Cognito、ローカルは模擬 OIDC。
// ログインのリダイレクトはブラウザに依るので、共有のパッケージ(client-core)には置かず、
// アクセストークンを返す関数だけを渡す。
import { UserManager, WebStorageStateStore } from "oidc-client-ts";

import { config } from "./config.ts";

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
    // タブを閉じてもログインを保つ(Cognito の web クライアントのリフレッシュトークンは30日)
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    // アクセストークンの期限が近づいたら、リフレッシュトークンで更新する
    automaticSilentRenew: true,
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
