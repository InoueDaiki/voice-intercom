// 端末に覚えておくもの。閉じたアプリを push で起こしたとき、画面の操作なしで入室し直すのに使う

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

export interface PocSettings {
  // 模擬 OIDC の username(トークンの sub になる)
  username: string;
  roomId: string;
  // Push to Talk のチャンネル(UUID)。roomId ごとに作る
  channelId?: string;
}

const key = "ptt-poc.settings";

export async function loadSettings(): Promise<PocSettings | undefined> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as PocSettings) : undefined;
}

export async function saveSettings(settings: PocSettings): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(settings));
}

const extra = Constants.expoConfig?.extra as { devHost?: string; bundleId?: string } | undefined;

// ローカルの環境の接続先(.env の DEV_HOST をビルドのときに埋める)
export const devHost = extra?.devHost ?? "localhost";
export const bundleId = extra?.bundleId ?? "";
export const oidcBaseUrl = `http://${devHost}:8090/default`;
export const apiBaseUrl = `http://${devHost}:3000`;
