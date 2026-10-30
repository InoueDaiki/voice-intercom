import { Button, FullScreenMessage } from "@voice-intercom/ui-native";
import { useRouter } from "expo-router";

// 見つからないパス(古いリンクなど)
export default function NotFound() {
  const router = useRouter();
  return (
    <FullScreenMessage
      action={
        <Button variant="primary" onPress={() => router.replace("/")}>
          ルームの一覧へ
        </Button>
      }
    >
      ページが見つかりません。
    </FullScreenMessage>
  );
}
