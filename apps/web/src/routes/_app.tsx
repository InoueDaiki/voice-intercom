import { LANGUAGE_LABELS } from "@voice-intercom/client-core";
import { AppHeader, appHeaderLinkClass, appHeaderTextClass, Button, FullScreenMessage, LoadErrorAlert } from "@voice-intercom/ui-web";
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
    content = <p className={pageClass}>読み込み中…</p>;
  } else if (me.isError) {
    content = (
      <LoadErrorAlert className={pageClass} onRetry={() => void me.refetch()}>
        プロフィールを取得できません: {errorMessage(me.error)}
      </LoadErrorAlert>
    );
  } else if (me.data === null && location.pathname !== "/profile") {
    content = <Navigate to="/profile" replace />;
  } else {
    content = <Outlet />;
  }

  return (
    // 列は画面の幅を超えない(grid-cols-1)。中身の長い文字列で画面ごと横に広がらないように
    <div className="grid h-dvh grid-cols-1 grid-rows-[auto_1fr]">
      <AppHeader
        brand={<Link to="/">voice-intercom</Link>}
        account={
          me.data ? (
            <Link to="/profile" title="プロフィール(表示名と言語)" className={appHeaderLinkClass}>
              {me.data.display_name}
              <span className="ml-1.5 hidden text-on-key/70 sm:inline">{LANGUAGE_LABELS[me.data.language]}</span>
            </Link>
          ) : (
            <span className={appHeaderTextClass}>{user?.profile.email ?? user?.profile.sub}</span>
          )
        }
        onSignOut={() => void signOut()}
      />
      {/* 余白は各画面が持つ(ルームの画面は端まで使う) */}
      <main className="min-h-0 overflow-auto">{content}</main>
    </div>
  );
}

// ルームの画面以外の、本文の余白。幅はルームの画面とそろえ、行き来しても題の位置が動かないようにする
const pageClass = "mx-auto max-w-3xl px-4 py-8 sm:px-6";
