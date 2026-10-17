import type { ComponentProps } from "react";

import { cx } from "./cx.ts";

// primary: 画面の主な操作(1画面に1つ)。secondary: それ以外の操作。
// ghost: ヘッダーなどの目立たせない操作。danger: 削除など取り返しのつかない操作。
// link: 文の中や行の端に置く、文字だけの操作
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const baseClass =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap no-underline transition-[color,background-color,translate] select-none hover:no-underline disabled:cursor-not-allowed disabled:opacity-50";

const variantClasses: Record<ButtonVariant, string> = {
  // 点灯したキー。下の縁を濃くしてキーの厚みを出し、押すと沈める
  primary:
    "rounded-md border-b-2 border-primary-hover bg-primary font-bold text-on-primary not-disabled:hover:bg-primary-hover not-disabled:active:translate-y-px",
  secondary:
    "rounded-md border border-border-strong bg-surface text-fg not-disabled:hover:bg-surface-muted not-disabled:active:bg-surface-strong",
  ghost: "rounded-md text-fg not-disabled:hover:bg-surface-muted not-disabled:active:bg-surface-strong",
  danger: "rounded-md bg-danger font-bold text-on-danger not-disabled:hover:opacity-90",
  link: "rounded-sm text-fg underline decoration-border-strong underline-offset-3 not-disabled:hover:decoration-fg",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

// リンク(<Link>)をボタンの見た目にするときにも使う
export function buttonClass({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  // link は文字の大きさを周りに合わせ、高さと余白を持たない
  return cx(baseClass, variantClasses[variant], variant !== "link" && sizeClasses[size], className);
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
