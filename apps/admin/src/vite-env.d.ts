/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OIDC_ISSUER?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_OIDC_LOGOUT_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  // "1" のとき、開発サーバーでだけ管理 API をモックにする(src/mockAdminApi.ts)
  readonly VITE_API_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
