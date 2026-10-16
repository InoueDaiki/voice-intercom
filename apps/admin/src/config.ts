// ビルド時に埋め込む設定。値は VITE_ で始まる環境変数で渡す
// (ローカルの既定は vite.config.ts と README を参照)。

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていない`);
  }
  return value;
}

export const config = {
  // トークンの iss と一致させる。ローカルは模擬 OIDC(リポジトリ直下の .env の OIDC_ISSUER)
  // ビルドで SPA の index.html を作るときにも読み込まれるので、使うときに確かめる
  get oidcIssuer(): string {
    return required("VITE_OIDC_ISSUER", import.meta.env.VITE_OIDC_ISSUER);
  },
  // Cognito の管理コンソール用のクライアント。模擬 OIDC では何でもよいので、Cognito の名前に揃える
  oidcClientId: import.meta.env.VITE_OIDC_CLIENT_ID || "admin",
  // Cognito はログアウトが標準の end_session_endpoint ではないので、
  // <hosted_ui_url>/logout を渡す。空なら探索で得た end_session_endpoint を使う(模擬 OIDC)
  oidcLogoutUrl: import.meta.env.VITE_OIDC_LOGOUT_URL || undefined,
  // ローカルは Vite の中継(/api → localhost:3000)。AWS では API Gateway の URL
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
};
