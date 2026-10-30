// いちばん外のレイアウト。データの取得、API、ログインの状態を用意し、ログインしていなければログインの画面だけを出す
import "../global.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiProvider } from "@voice-intercom/client-react";
import { FullScreenMessage, useTokenColor } from "@voice-intercom/ui-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaListener, SafeAreaProvider } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import { api } from "../api.ts";
import { auth, useAuth } from "../auth.ts";

// 保管したトークンを、最初の画面を描く前から読み始める
void auth.load();

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // 401 / 403 を繰り返さないよう、再試行は1回にする
          queries: { retry: 1 },
        },
      }),
  );
  return (
    <SafeAreaProvider>
      {/* 安全な領域(ノッチ、ホームのバー)を、pb-safe などのクラスで使えるようにする */}
      <SafeAreaListener style={{ flex: 1 }} onChange={({ insets }) => Uniwind.updateInsets(insets)}>
        <QueryClientProvider client={queryClient}>
          <ApiProvider api={api}>
            <StatusBar style="auto" />
            <Root />
          </ApiProvider>
        </QueryClientProvider>
      </SafeAreaListener>
    </SafeAreaProvider>
  );
}

function Root() {
  const { state } = useAuth();
  const canvas = useTokenColor("canvas");
  if (state.status === "loading") {
    return <FullScreenMessage>読み込み中…</FullScreenMessage>;
  }
  const signedIn = state.status === "signedIn";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: canvas } }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
