import { Badge, Button, cx } from "@voice-intercom/ui-web";
import { useAuth } from "react-oidc-context";
import { NavLink, Outlet } from "react-router";

import { isMock } from "./adminApi.ts";
import { signOut } from "./auth.ts";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    "rounded-md px-3 py-2 text-sm font-medium no-underline hover:no-underline",
    isActive ? "bg-primary-soft text-primary-fg" : "text-fg hover:bg-surface-muted",
  );

export function Layout() {
  const { user } = useAuth();
  return (
    <div className="grid min-h-dvh grid-rows-[auto_auto_1fr] md:grid-cols-[13rem_1fr] md:grid-rows-[auto_1fr]">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 md:col-span-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-bold">voice-intercom</span>
          <span className="text-sm text-fg-muted">管理コンソール</span>
          {isMock && <Badge tone="warning">モック API</Badge>}
        </span>
        <span className="flex items-center gap-3 text-sm">
          {/* Cognito の username は UUID なので、メールアドレスを出す */}
          <span className="hidden text-fg-muted sm:inline">{user?.profile.email ?? user?.profile.sub}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            ログアウト
          </Button>
        </span>
      </header>
      <nav className="flex gap-1 border-b border-border px-3 py-2 md:flex-col md:border-r md:border-b-0 md:py-4">
        <NavLink to="/" end className={navLinkClass}>
          ホーム
        </NavLink>
        <NavLink to="/rooms" className={navLinkClass}>
          ルーム
        </NavLink>
        <NavLink to="/users" className={navLinkClass}>
          ユーザー
        </NavLink>
      </nav>
      <main className="min-w-0 px-4 py-6 md:px-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
