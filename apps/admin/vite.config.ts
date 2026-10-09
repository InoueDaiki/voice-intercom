import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// 設定は VITE_ で始まる環境変数で渡す(src/config.ts)。
// ローカルでは、mise が読み込むリポジトリ直下の .env の値を既定にする。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_OIDC_ISSUER": JSON.stringify(env.VITE_OIDC_ISSUER || env.OIDC_ISSUER || ""),
    },
    server: {
      // devContainer の外(ホストのブラウザ)から compose の公開ポートで届くようにする
      host: true,
      port: 5173,
      strictPort: true,
      // ローカルの API(3000 番)へ中継する。同じオリジンになるので CORS が要らない
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
