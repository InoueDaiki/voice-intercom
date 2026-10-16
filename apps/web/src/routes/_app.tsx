import { useEffect } from "react";
import { hasAuthParams, useAuth } from "react-oidc-context";
import { Link, Navigate, Outlet, useLocation } from "react-router";

import { signOut } from "../auth.ts";
import { errorMessage, useMe } from "../queries.ts";

// パスを持たないレイアウト。ログインしていなければログイン画面へ送り、
// プロフィール(表示名と言語)が未登録ならプロフィールの画面へ送る(LiveKit のトークンに要る)
export default function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const needsSignIn =
    !auth.isAuthenticated && !auth.isLoading && !auth.activeNavigator && !auth.error && !hasAuthParams();

  useEffect(() => {
    if (needsSignIn) {
      void auth.signinRedirect({ state: location.pathname + location.search });
    }
  }, [needsSignIn, auth, location]);

  if (auth.error) {
    return (
      <main className="centered">
        <p>ログインに失敗しました: {auth.error.message}</p>
        <button type="button" onClick={() => void auth.signinRedirect()}>
          ログインし直す
        </button>
      </main>
    );
  }
  if (!auth.isAuthenticated || !auth.user) {
    return <main className="centered">ログイン画面へ移動しています…</main>;
  }
  return <SignedIn />;
}

function SignedIn() {
  const { user } = useAuth();
  const location = useLocation();
  const me = useMe();

  let content;
  if (me.isPending) {
    content = <p>読み込み中…</p>;
  } else if (me.isError) {
    content = (
      <div className="error" role="alert">
        <p>プロフィールを取得できません: {errorMessage(me.error)}</p>
        <button type="button" onClick={() => void me.refetch()}>
          再読み込み
        </button>
      </div>
    );
  } else if (me.data === null && location.pathname !== "/profile") {
    content = <Navigate to="/profile" replace />;
  } else {
    content = <Outlet />;
  }

  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="title">
          voice-intercom
        </Link>
        <span className="user">
          {me.data && (
            <Link to="/profile" title="プロフィール">
              {me.data.display_name}
            </Link>
          )}
          {!me.data && <span className="muted">{user?.profile.email ?? user?.profile.sub}</span>}
          <button type="button" onClick={() => void signOut()}>
            ログアウト
          </button>
        </span>
      </header>
      <main className="content">{content}</main>
    </div>
  );
}
