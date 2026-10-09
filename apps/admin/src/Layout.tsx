import { useAuth } from "react-oidc-context";
import { NavLink, Outlet } from "react-router";

import { signOut } from "./auth.ts";

export function Layout() {
  const { user } = useAuth();
  return (
    <div className="layout">
      <header className="header">
        <span className="title">voice-intercom 管理コンソール</span>
        <span className="user">
          {/* Cognito の username は UUID なので、メールアドレスを出す */}
          {user?.profile.email ?? user?.profile.sub}
          <button type="button" onClick={() => void signOut()}>
            ログアウト
          </button>
        </span>
      </header>
      <nav className="nav">
        <NavLink to="/" end>
          ホーム
        </NavLink>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
