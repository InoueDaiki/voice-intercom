import { Alert, Button, Text } from "@voice-intercom/ui-native";
import { View } from "react-native";

import { useAuth } from "../auth.ts";

// ログインの画面。押すと OS のブラウザでログインの画面(Cognito。ローカルは模擬 OIDC)を開く
export default function SignIn() {
  const auth = useAuth();
  const { state } = auth;
  const busy = state.status === "signingIn";
  return (
    <View className="flex-1 items-center justify-center gap-6 bg-canvas p-6">
      <View className="items-center gap-2">
        <Text className="text-2xl font-bold">voice-intercom</Text>
        <Text className="text-center text-fg-muted">ルームで話し、訳された字幕を読めます。</Text>
      </View>
      {state.status === "signedOut" && state.error && (
        <Alert tone="danger" className="w-full max-w-md">
          {state.error}
        </Alert>
      )}
      <Button variant="primary" size="lg" disabled={busy} onPress={() => void auth.signIn()}>
        {busy ? "ログインしています…" : "ログイン"}
      </Button>
    </View>
  );
}
