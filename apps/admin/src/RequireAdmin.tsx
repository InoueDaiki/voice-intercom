import { Button, FullScreenMessage } from "@voice-intercom/ui-web";
import { useEffect, type ReactNode } from "react";
import { hasAuthParams, useAuth } from "react-oidc-context";
import { useLocation } from "react-router";

import { ADMIN_GROUP, groupsOf, signOut } from "./auth.ts";

// ログインしていなければログイン画面へ送り、admin グループでなければ画面を見せない。
// 実際の権限の判定は API がする。ここは表示の出し分けだけ
export function RequireAdmin({ children }: { children: ReactNode }) {
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
  if (!groupsOf(auth.user).includes(ADMIN_GROUP)) {
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
