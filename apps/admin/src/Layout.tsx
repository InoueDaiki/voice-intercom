import { Badge, Button, cx } from "@voice-intercom/ui-web";
import { useAuth } from "react-oidc-context";
import { NavLink, Outlet } from "react-router";

import { isMock } from "./adminApi.ts";
import { ADMIN_GROUP, groupsOf, OPERATOR_GROUP, signOut } from "./auth.ts";

// 選んでいる項目は、左(幅の狭い画面では下)に琥珀の線を灯す
const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    "border-b-2 px-3 py-2 text-sm no-underline md:rounded-r-md md:border-b-0 md:border-l-2",
    isActive
      ? "border-primary font-bold text-fg md:bg-surface-muted"
      : "border-transparent text-fg-muted hover:bg-surface-muted hover:text-fg",
  );

export function Layout() {
  const { user } = useAuth();
  const groups = user ? groupsOf(user) : [];
  // 管理者は自分のテナントを、運営者はテナントとユーザーの所属を扱う(両方の人もいる)
  const isAdmin = groups.includes(ADMIN_GROUP);
  const isOperator = groups.includes(OPERATOR_GROUP);
  return (
    <div className="grid min-h-dvh grid-rows-[auto_auto_1fr] md:grid-cols-[13rem_1fr] md:grid-rows-[auto_1fr]">
      <header className="flex h-12 items-center justify-between gap-4 bg-key px-4 text-on-key md:col-span-2">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold">voice-intercom</span>
          <span className="text-sm text-on-key/70">管理コンソール</span>
          {isMock && <Badge tone="warning">モック API</Badge>}
        </span>
        <span className="flex items-center gap-1 text-sm">
          {/* Cognito の username は UUID なので、メールアドレスを出す */}
          <span className="hidden px-2 text-on-key/70 sm:inline">{user?.profile.email ?? user?.profile.sub}</span>
          <Button variant="ghost" size="sm" className="text-on-key not-disabled:hover:bg-key-hover" onClick={() => void signOut()}>
            ログアウト
          </Button>
        </span>
      </header>
      <nav className="flex gap-1 border-b border-border bg-surface px-3 md:flex-col md:border-r md:border-b-0 md:py-4 md:pr-3 md:pl-0">
        <NavLink to="/" end className={navLinkClass}>
          ホーム
        </NavLink>
        {isAdmin && (
          <>
            <NavLink to="/rooms" className={navLinkClass}>
              ルーム
            </NavLink>
            <NavLink to="/connect" className={navLinkClass}>
              Connect
            </NavLink>
          </>
        )}
        <NavLink to="/users" className={navLinkClass}>
          ユーザー
        </NavLink>
        {isOperator && (
          <NavLink to="/tenants" className={navLinkClass}>
            テナント
          </NavLink>
        )}
      </nav>
      <main className="min-w-0 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
