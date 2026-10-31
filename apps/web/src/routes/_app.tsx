import { LANGUAGE_LABELS } from "@voice-intercom/client-core";
import { errorMessage, RoomHubProvider, useMe } from "@voice-intercom/client-react";
import { AppHeader, appHeaderLinkClass, appHeaderTextClass, Button, FullScreenMessage, LoadErrorAlert } from "@voice-intercom/ui-web";
import { useEffect } from "react";
import { hasAuthParams, useAuth } from "react-oidc-context";
import { Link, Navigate, Outlet, useLocation, useMatch } from "react-router";

import { AudioDock } from "../AudioDock.tsx";
import { signOut, useLoginLost } from "../auth.ts";
import { webAppPresence, webRoomPlatform, webScreenAwake } from "../roomPlatform.ts";
import { SpacePtt } from "../spacePtt.ts";

// パスを持たないレイアウト。ログインしていなければログイン画面へ送り、
// プロフィール(表示名と言語)が未登録ならプロフィールの画面へ送る(LiveKit のトークンに要る)
export default function AppLayout() {
  const auth = useAuth();
  const location = useLocation();
  const loginLost = useLoginLost(auth);
  const needsSignIn =
    !auth.isAuthenticated && !auth.isLoading && !auth.activeNavigator && !auth.error && !hasAuthParams();

  useEffect(() => {
    if (needsSignIn) {
      void auth.signinRedirect({ state: location.pathname + location.search });
    }
  }, [needsSignIn, auth, location]);

  // 自動更新の失敗だけでは出さない。ここで止めると RoomHub ごと接続が切れる
  if (loginLost && auth.error) {
    return (
      <FullScreenMessage
        action={
          <Button variant="primary" onClick={() => void auth.signinRedirect()}>
            ログインし直す
          </Button>
        }
      >
        {auth.error.source === "renewSilent"
          ? "ログインが切れました。ログインし直してください。"
          : `ログインに失敗しました: ${auth.error.message}`}
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
  } else if (me.isError && me.data === undefined) {
    // 読み直しの失敗なら、持っているプロフィールで表示を続ける
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

  const layout = (
    // 列は画面の幅を超えない(grid-cols-1)。中身の長い文字列で画面ごと横に広がらないように。
    // 下の段は音声中の帯(音声をつないだルームがあるときだけ)
    <div className="grid h-dvh grid-cols-1 grid-rows-[auto_1fr_auto]">
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
      {me.data && myIdentity && <AudioDock currentRoomId={roomMatch?.params.roomId} myIdentity={myIdentity} />}
    </div>
  );
  // ルームの接続(音声中のルームを含む)は、画面を移っても保つ
  return me.data && myIdentity ? (
    <RoomHubProvider
      me={me.data}
      myIdentity={myIdentity}
      platform={webRoomPlatform}
      presence={webAppPresence}
      createAwake={webScreenAwake}
    >
      <SpacePtt />
      {layout}
    </RoomHubProvider>
  ) : (
    layout
  );
}

// ルームの画面以外の、本文の余白。幅はルームの画面とそろえ、行き来しても題の位置が動かないようにする
const pageClass = "mx-auto max-w-3xl px-4 py-8 sm:px-6";
