import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DOM を使わないので、Node のまま動かす
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
