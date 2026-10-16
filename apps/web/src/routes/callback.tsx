import { buttonClass, FullScreenMessage } from "@voice-intercom/ui-web";
import { useAuth } from "react-oidc-context";

// 認可コードを受け取る(処理は AuthProvider がする)
export default function Callback() {
  const auth = useAuth();
  if (auth.error) {
    return (
      <FullScreenMessage
        action={
          <a href="/" className={buttonClass({ variant: "primary" })}>
            最初からやり直す
          </a>
        }
      >
        ログインに失敗しました: {auth.error.message}
      </FullScreenMessage>
    );
  }
  return <FullScreenMessage>ログインしています…</FullScreenMessage>;
}
