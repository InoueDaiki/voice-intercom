import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  // 題の上に置く戻るリンク
  back?: ReactNode;
  // 右に並べる操作
  actions?: ReactNode;
}

// 画面の題。各画面の最初に置く
export function PageHeader({ title, description, back, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 grid gap-1">
      {back && <div className="text-sm">{back}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="text-sm text-fg-muted">{description}</p>}
    </header>
  );
}
