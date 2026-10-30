// ビルドのときに埋め込む設定(app.config.ts の extra)
import Constants from "expo-constants";

interface Extra {
  oidcIssuer: string;
  oidcClientId: string;
  oidcLogoutUrl?: string;
  apiBaseUrl: string;
}

const extra = Constants.expoConfig?.extra as Extra | undefined;
if (!extra) {
  throw new Error("app.config.ts の extra が読めない");
}

export const config = extra;
