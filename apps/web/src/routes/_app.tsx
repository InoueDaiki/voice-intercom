import { Alert, Button, FullScreenMessage } from "@voice-intercom/ui-web";
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
      <FullScreenMessage
        action={
          <Button variant="primary" onClick={() => void auth.signinRedirect()}>
            ログインし直す
          </Button>
        }
      >
        ログインに失敗しました: {auth.error.message}
      </FullScreenMessage>
    );
  }
  if (!auth.isAuthenticated || !auth.user) {
    return <FullScreenMessage>ログイン画面へ移動しています…</FullScreenMessage>;
  }
  return <SignedIn />;
}

function SignedIn() {
  const { user } = useAuth();
  const location = useLocation();
  const me = useMe();

  let content;
  if (me.isPending) {
    content = <p className="text-fg-muted">読み込み中…</p>;
  } else if (me.isError) {
    content = (
      <Alert
        tone="danger"
        action={
          <Button size="sm" onClick={() => void me.refetch()}>
            再読み込み
          </Button>
        }
      >
        プロフィールを取得できません: {errorMessage(me.error)}
      </Alert>
    );
  } else if (me.data === null && location.pathname !== "/profile") {
    content = <Navigate to="/profile" replace />;
  } else {
    content = <Outlet />;
  }

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr]">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <Link to="/" className="font-bold text-fg no-underline hover:no-underline">
          voice-intercom
        </Link>
        <span className="flex items-center gap-3 text-sm">
          {me.data && (
            <Link to="/profile" title="プロフィール" className="font-medium">
              {me.data.display_name}
            </Link>
          )}
          {!me.data && <span className="text-fg-muted">{user?.profile.email ?? user?.profile.sub}</span>}
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            ログアウト
          </Button>
        </span>
      </header>
      <main className="min-h-0 overflow-auto px-4 py-6 sm:px-6">{content}</main>
    </div>
  );
}
