import { Button, FullScreenMessage } from "@voice-intercom/ui-web";
import { useEffect, useRef, type ReactNode } from "react";
import { hasAuthParams, useAuth } from "react-oidc-context";
import { useLocation } from "react-router";

import { ADMIN_GROUP, groupsOf, OPERATOR_GROUP, isSigningOut, restoreLogin, signOut, useLoginLost } from "./auth.ts";

// ログインしていなければログイン画面へ送り、admin か operator のグループでなければ画面を見せない。
// 実際の権限の判定は API がする。ここは表示の出し分けだけ
export function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const loginLost = useLoginLost(auth);
  const returnTo = location.pathname + location.search;
  const needsSignIn =
    !auth.isAuthenticated &&
    !auth.isLoading &&
    !auth.activeNavigator &&
    !auth.error &&
    !hasAuthParams() &&
    !isSigningOut();

  // 認可の画面へ送る前に、リフレッシュトークンを試す。試すのは、ログインが要る状態になるごとに1回
  const signingIn = useRef(false);
  useEffect(() => {
    if (!needsSignIn) {
      signingIn.current = false;
      return;
    }
    if (signingIn.current) {
      return;
    }
    signingIn.current = true;
    void restoreLogin().then((restored) => {
      if (!restored) {
        void auth.signinRedirect({ state: returnTo });
      }
    });
  }, [needsSignIn, auth, returnTo]);

  if (loginLost && auth.error) {
    return (
      <FullScreenMessage
        action={
          <Button variant="primary" onClick={() => void auth.signinRedirect({ state: returnTo })}>
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
  const groups = groupsOf(auth.user);
  if (!groups.includes(ADMIN_GROUP) && !groups.includes(OPERATOR_GROUP)) {
    return (
      <FullScreenMessage
        action={
          <Button onClick={() => void signOut()}>
            ログアウト
          </Button>
        }
      >
        このアカウントには管理コンソールを使う権限がありません。
      </FullScreenMessage>
    );
  }
  return children;
}
