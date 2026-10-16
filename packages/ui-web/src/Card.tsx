import type { ComponentProps } from "react";

import { cx } from "./cx.ts";

export interface CardProps extends ComponentProps<"div"> {
  // danger: 削除などの操作をまとめる面
  tone?: "default" | "danger";
}

// 地の上に置く面。中身の余白は既定で p-4(className で変えられる)
export function Card({ tone = "default", className, ...props }: CardProps) {
  return (
    <div
      className={cx(
        "rounded-lg border bg-surface p-4",
        tone === "danger" ? "border-danger" : "border-border",
        className,
      )}
      {...props}
    />
  );
}
