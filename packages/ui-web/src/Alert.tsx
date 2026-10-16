import type { ComponentProps, ReactNode } from "react";

import { cx } from "./cx.ts";

export type AlertTone = "info" | "success" | "warning" | "danger";

const toneClasses: Record<AlertTone, string> = {
  info: "bg-primary-soft text-fg",
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-fg",
  danger: "bg-danger-soft text-danger-fg",
};

export interface AlertProps extends ComponentProps<"div"> {
  tone?: AlertTone;
  // 右に並べる操作(再読み込みなど)
  action?: ReactNode;
}

// 画面の中の知らせ。danger は既定で role="alert"(読み上げですぐ伝える)
export function Alert({ tone = "info", action, className, children, role, ...props }: AlertProps) {
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : undefined)}
      className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md px-3 py-2 text-sm", toneClasses[tone], className)}
      {...props}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
