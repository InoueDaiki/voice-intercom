import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // devContainer の外(ホストのブラウザ、同じ LAN のスマートフォン)から届くようにする
    host: true,
    // 管理コンソール(5173)、Web 版(5174)、見本帳(5175)と並べて動かす
    port: 5176,
    strictPort: true,
  },
});
