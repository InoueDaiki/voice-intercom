import type { Config } from "@react-router/dev/config";

export default {
  // SPA として配信する(サーバーでは描画しない)。ビルドは build/client に静的なファイルを出す
  ssr: false,
  appDirectory: "src",
} satisfies Config;
