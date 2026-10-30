// Expo の設定。値は .env から読む(mise が読み込む。README の「モバイル版」)。
// - DEV_HOST: ローカルの OIDC・API・LiveKit の接続先(Mac の LAN の IP)。AWS の環境では使わない
// - MOBILE_OIDC_ISSUER・MOBILE_OIDC_CLIENT_ID・MOBILE_OIDC_LOGOUT_URL・MOBILE_API_BASE_URL: AWS の環境の接続先
//   (無ければローカルの模擬 OIDC と API)
// - MOBILE_BUNDLE_ID・APPLE_TEAM_ID: 実機に入れるときの App ID と署名のチーム

import type { ConfigContext, ExpoConfig } from "expo/config";

const devHost = process.env.DEV_HOST ?? "localhost";
const bundleId = process.env.MOBILE_BUNDLE_ID ?? "dev.voiceintercom.mobile";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "voice-intercom",
  slug: "voice-intercom",
  version: "0.1.0",
  // ログインのリダイレクト(voiceintercom://callback。Cognito の mobile クライアントの callback_urls と同じ)
  scheme: "voiceintercom",
  orientation: "portrait",
  // 明暗は OS の設定に従う(トークンが切り替える)
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: bundleId,
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: true,
    infoPlist: {
      NSMicrophoneUsageDescription: "ルームで話すときに、マイクを使います",
      // ローカルの環境は http と ws で動く。AWS の環境は https なので、配信するビルドでは外す
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSLocalNetworkUsageDescription: "開発用のサーバー(Mac)につなぎます",
    },
  },
  android: {
    package: bundleId,
    permissions: ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    // 選ぶだけなので、写真とカメラの権限は求めない(カメラで撮るのはまだ作っていない)。
    // microphonePermission に false を渡すと、ルームで使うマイクの権限まで消えるので渡さない
    ["expo-image-picker", { photosPermission: false, cameraPermission: false }],
    [
      "expo-font",
      {
        // 書体は ui-web と同じ IBM Plex Sans JP。太さは 400・500・700 だけを使う
        fonts: ["400Regular", "500Medium", "700Bold"].map(
          (w) => `node_modules/@expo-google-fonts/ibm-plex-sans-jp/${w}/IBMPlexSansJP_${w}.ttf`,
        ),
      },
    ],
    "@livekit/react-native-expo-plugin",
    "@config-plugins/react-native-webrtc",
  ],
  experiments: { typedRoutes: true },
  extra: {
    oidcIssuer: process.env.MOBILE_OIDC_ISSUER ?? `http://${devHost}:8090/default`,
    // Cognito の mobile クライアント。模擬 OIDC では何でもよいので、Cognito の名前に揃える
    oidcClientId: process.env.MOBILE_OIDC_CLIENT_ID ?? "mobile",
    // Cognito はログアウトが標準の end_session_endpoint ではないので、<hosted_ui_url>/logout を渡す
    oidcLogoutUrl: process.env.MOBILE_OIDC_LOGOUT_URL,
    apiBaseUrl: process.env.MOBILE_API_BASE_URL ?? `http://${devHost}:3000`,
  },
});
