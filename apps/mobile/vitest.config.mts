import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 端末の API は vi.mock で差し替え、端末に依らない流れだけを Node で確かめる
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
