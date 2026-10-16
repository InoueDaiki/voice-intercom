import type { ComponentProps } from "react";

import { cx } from "./cx.ts";

// primary: 画面の主な操作(1画面に1つ)。secondary: それ以外の操作。
// ghost: ヘッダーなどの目立たせない操作。danger: 削除など取り返しのつかない操作。
// link: 文の中や行の端に置く、文字だけの操作
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const baseClass =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap no-underline transition-colors select-none hover:no-underline disabled:cursor-not-allowed disabled:opacity-50";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "rounded-md bg-primary text-on-primary not-disabled:hover:bg-primary-hover",
  secondary: "rounded-md border border-border-strong bg-surface text-fg not-disabled:hover:bg-surface-muted",
  ghost: "rounded-md text-fg not-disabled:hover:bg-surface-muted",
  danger: "rounded-md bg-danger text-on-danger not-disabled:hover:opacity-90",
  link: "rounded-sm text-primary-fg underline-offset-2 not-disabled:hover:underline",
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
