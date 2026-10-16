import { useAuth } from "react-oidc-context";

// 認可コードを受け取る(処理は AuthProvider がする)
export default function Callback() {
  const auth = useAuth();
  if (auth.error) {
    return (
      <main className="centered">
        <p>ログインに失敗しました: {auth.error.message}</p>
        <a href="/">最初からやり直す</a>
      </main>
    );
  }
  return <main className="centered">ログインしています…</main>;
}
