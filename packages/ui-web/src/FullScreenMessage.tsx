import type { ReactNode } from "react";

// 画面全体の真ん中に出す知らせ(読み込み中、ログインの失敗、権限がない)
export function FullScreenMessage({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-content-center justify-items-center gap-4 p-6 text-center">
      <div className="text-fg-muted">{children}</div>
      {action}
    </main>
  );
}
