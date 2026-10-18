import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// 設定は VITE_ で始まる環境変数で渡す(src/config.ts)。
// ローカルでは、mise が読み込むリポジトリ直下の .env の値を既定にする。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [tailwindcss(), reactRouter()],
    // 動画の変換の Worker(src/video)を ES モジュールにする。AAC の符号化器(大きい)を、要るときだけ
    // 読み込む別のチャンクに分けるため(既定の iife では Worker の中の動的 import が分けられない)
    worker: { format: "es" },
    define: {
      "import.meta.env.VITE_OIDC_ISSUER": JSON.stringify(env.VITE_OIDC_ISSUER || env.OIDC_ISSUER || ""),
    },
    server: {
      // devContainer の外(ホストのブラウザ)から compose の公開ポートで届くようにする
      host: true,
      // 管理コンソール(5173)と並べて動かす。Cognito の web クライアントの戻り先もこのポート
      port: 5174,
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
