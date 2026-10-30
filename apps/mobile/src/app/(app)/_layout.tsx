// ログインした後のレイアウト。プロフィール(表示名と言語)が未登録なら登録の画面だけを出す(LiveKit のトークンに要る)。
// ルームの接続(音声中のルームを含む)は、画面を移っても保つ(RoomHub)。音声中の帯は、どの画面でも下に出す
import { errorMessage, RoomHubProvider, useMe } from "@voice-intercom/client-react";
import { Button, FullScreenMessage, LoadErrorAlert, useTokenColor } from "@voice-intercom/ui-native";
import { Stack } from "expo-router";
import { View } from "react-native";

import { useAuth } from "../../auth.ts";
import { AudioDock } from "../../room/AudioDock.tsx";
import { AudioSessionKeeper } from "../../room/AudioSessionKeeper.tsx";
import { mobileAppPresence, mobileRoomPlatform, mobileScreenAwake } from "../../roomPlatform.ts";

export default function AppLayout() {
  const auth = useAuth();
  const me = useMe();
  const myIdentity = auth.state.status === "signedIn" ? auth.state.user.sub : undefined;
  const key = useTokenColor("key");
  const onKey = useTokenColor("on-key");
  const canvas = useTokenColor("canvas");

  if (me.isPending) {
    return <FullScreenMessage>読み込み中…</FullScreenMessage>;
  }
  if (me.isError || !myIdentity) {
    return (
      <FullScreenMessage
        action={
          <Button variant="ghost" onPress={() => void auth.signOut()}>
            ログアウト
          </Button>
        }
      >
        <LoadErrorAlert onRetry={() => void me.refetch()}>
          プロフィールを取得できません: {errorMessage(me.error)}
        </LoadErrorAlert>
      </FullScreenMessage>
    );
  }

  const registered = me.data !== null;
  const stack = (
    <Stack
      screenOptions={{
        // 上の帯は Web 版の AppHeader と同じ、消灯したキーの色
        headerStyle: { backgroundColor: key },
        headerTintColor: onKey,
        headerTitleStyle: { fontWeight: "700" },
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: canvas },
      }}
    >
      <Stack.Protected guard={registered}>
        <Stack.Screen name="index" options={{ title: "voice-intercom" }} />
        <Stack.Screen name="profile" options={{ title: "プロフィール" }} />
        <Stack.Screen name="rooms/new" options={{ title: "ルームを作る" }} />
        <Stack.Screen name="rooms/[roomId]/index" options={{ title: "" }} />
        <Stack.Screen name="rooms/[roomId]/settings" options={{ title: "メンバーと設定" }} />
      </Stack.Protected>
      <Stack.Protected guard={!registered}>
        <Stack.Screen name="welcome" options={{ title: "プロフィールの登録" }} />
      </Stack.Protected>
    </Stack>
  );
  if (!me.data) {
    return stack;
  }
  return (
    <RoomHubProvider
      me={me.data}
      myIdentity={myIdentity}
      platform={mobileRoomPlatform}
      presence={mobileAppPresence}
      createAwake={mobileScreenAwake}
    >
      <AudioSessionKeeper />
      <View className="flex-1 bg-canvas">
        {stack}
        <AudioDock myIdentity={myIdentity} />
      </View>
    </RoomHubProvider>
  );
}
