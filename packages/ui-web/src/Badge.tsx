import type { ComponentProps } from "react";

import { cx } from "./cx.ts";

// neutral: 件数や種類などの添え書き。live: 送話中(TX)。rx: 受信中
export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "live" | "rx";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-fg-muted",
  primary: "bg-primary-soft text-primary-fg",
  success: "bg-success-soft text-success-fg",
  warning: "bg-warning-soft text-warning-fg",
  danger: "bg-danger-soft text-danger-fg",
  live: "bg-live text-on-live",
  rx: "bg-rx-soft text-rx-fg",
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone;
}

// 短い状態の札(人数、翻訳あり、モック API など)
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
