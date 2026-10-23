import { LANGUAGE_LABELS } from "@voice-intercom/client-core";
import { Alert, Button, FullScreenMessage } from "@voice-intercom/ui-web";
import { useEffect } from "react";
import { hasAuthParams, useAuth } from "react-oidc-context";
import { Link, Navigate, Outlet, useLocation, useMatch } from "react-router";

import { AudioDock } from "../AudioDock.tsx";
import { signOut } from "../auth.ts";
import { errorMessage, useMe } from "../queries.ts";
import { RoomHubProvider } from "../roomHub.tsx";

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
  const roomMatch = useMatch("/rooms/:roomId");
  const myIdentity = user?.profile.sub;

  let content;
  if (me.isPending) {
    content = <p className={pageClass}>読み込み中…</p>;
  } else if (me.isError) {
    content = (
      <Alert
        className={pageClass}
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

  const layout = (
    // 列は画面の幅を超えない(grid-cols-1)。中身の長い文字列で画面ごと横に広がらないように。
    // 下の段は音声中の帯(音声をつないだルームがあるときだけ)
    <div className="grid h-dvh grid-cols-1 grid-rows-[auto_1fr_auto]">
      <header className="flex h-12 items-center justify-between gap-4 bg-key px-4 text-on-key">
        <Link to="/" className="shrink-0 font-bold text-on-key no-underline">
          voice-intercom
        </Link>
        {/* 長い表示名やメールアドレスは省いて、ログアウトを押し出さない */}
        <span className="flex min-w-0 items-center gap-1 text-sm">
          {me.data && (
            <Link
              to="/profile"
              title="プロフィール(表示名と言語)"
              className="min-w-0 truncate rounded-md px-2 py-1 text-on-key no-underline hover:bg-key-hover"
            >
              {me.data.display_name}
              <span className="ml-1.5 hidden text-on-key/70 sm:inline">{LANGUAGE_LABELS[me.data.language]}</span>
            </Link>
          )}
          {!me.data && <span className="min-w-0 truncate px-2 text-on-key/70">{user?.profile.email ?? user?.profile.sub}</span>}
          <Button variant="ghost" size="sm" className="shrink-0 text-on-key not-disabled:hover:bg-key-hover" onClick={() => void signOut()}>
            ログアウト
          </Button>
        </span>
      </header>
      {/* 余白は各画面が持つ(ルームの画面は端まで使う) */}
      <main className="min-h-0 overflow-auto">{content}</main>
      {me.data && myIdentity && <AudioDock currentRoomId={roomMatch?.params.roomId} myIdentity={myIdentity} />}
    </div>
  );
  // ルームの接続(音声中のルームを含む)は、画面を移っても保つ
  return me.data && myIdentity ? (
    <RoomHubProvider me={me.data} myIdentity={myIdentity}>
      {layout}
    </RoomHubProvider>
  ) : (
    layout
  );
}

// ルームの画面以外の、本文の余白。幅はルームの画面とそろえ、行き来しても題の位置が動かないようにする
const pageClass = "mx-auto max-w-3xl px-4 py-8 sm:px-6";
