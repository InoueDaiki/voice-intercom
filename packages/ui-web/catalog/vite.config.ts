import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    // devContainer の外(ホストのブラウザ)から compose の公開ポートで届くようにする
    host: true,
    // 管理コンソール(5173)と Web 版(5174)と並べて動かす
    port: 5175,
    strictPort: true,
  },
});
