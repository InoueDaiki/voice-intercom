// Expo の設定。値は .env から読む(mise が読み込む。README の「準備」)。
// - DEV_HOST: ローカルの OIDC・API・LiveKit の接続先(Mac の LAN の IP)
// - PTT_POC_BUNDLE_ID: Apple Developer で Push to Talk を有効にした App ID
// - APPLE_TEAM_ID: 署名に使うチーム

import type { ConfigContext, ExpoConfig } from "expo/config";

const bundleId = process.env.PTT_POC_BUNDLE_ID ?? "dev.voiceintercom.pttpoc";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "PTT PoC",
  slug: "ptt-poc",
  version: "0.1.0",
  orientation: "portrait",
  ios: {
    bundleIdentifier: bundleId,
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: true,
    infoPlist: {
      // ローカルの環境は http と ws で動く。PoC なので、どこへでも平文でつなげるようにする
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
      NSLocalNetworkUsageDescription: "開発用のサーバー(Mac)につなぎます",
    },
  },
  plugins: [
    "@livekit/react-native-expo-plugin",
    "@config-plugins/react-native-webrtc",
    ["@voice-intercom/intercom-os", { audioBackgroundMode: process.env.PTT_POC_AUDIO_BACKGROUND === "1" }],
  ],
  extra: {
    devHost: process.env.DEV_HOST,
    bundleId,
  },
});
