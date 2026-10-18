import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 試すのは src/core(DOM を使わない純粋な関数)だけなので、Node のまま動かす
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
