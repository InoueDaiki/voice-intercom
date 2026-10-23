import type { ReactNode } from "react";

import { Button } from "./Button.tsx";
import { cx } from "./cx.ts";

// 帯の中のリンク(プロフィールなど)。ルーターの <Link> に付けて使う
export const appHeaderLinkClass =
  "min-w-0 truncate rounded-md px-2 py-1 text-on-key no-underline hover:bg-key-hover hover:no-underline";

// 帯の中の、操作でない文字(ログインしているアカウントなど)
export const appHeaderTextClass = "min-w-0 truncate px-2 text-on-key/70";

export interface AppHeaderProps {
  // アプリの名前。ホームへのリンクにするなら <Link> を渡す(色と下線は帯が決める)
  brand: ReactNode;
  // 名前の横に添える文字(「管理コンソール」など)
  subtitle?: ReactNode;
  // 名前の横に添える札(モック API など)
  badge?: ReactNode;
  // 右に置くアカウントの表示。appHeaderLinkClass か appHeaderTextClass を付けて渡す
  account?: ReactNode;
  onSignOut: () => void;
  className?: string;
}

// アプリのいちばん上の帯。左にアプリの名前、右にアカウントとログアウトを置く。
// 長い表示名やメールアドレスは省いて、ログアウトを押し出さない
export function AppHeader({ brand, subtitle, badge, account, onSignOut, className }: AppHeaderProps) {
  return (
    <header className={cx("flex h-12 items-center justify-between gap-4 bg-key px-4 text-on-key", className)}>
      <span className="flex shrink-0 items-center gap-x-3">
        <span className="font-bold *:text-on-key *:no-underline">{brand}</span>
        {subtitle && <span className="text-sm text-on-key/70">{subtitle}</span>}
        {badge}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-sm">
        {account}
        <Button variant="ghost" size="sm" className="shrink-0 text-on-key not-disabled:hover:bg-key-hover" onClick={onSignOut}>
          ログアウト
        </Button>
      </span>
    </header>
  );
}
