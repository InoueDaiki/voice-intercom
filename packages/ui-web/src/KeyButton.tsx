import type { ComponentProps, ReactNode } from "react";

import { cx } from "./cx.ts";
import { keyShapeClass } from "./keyShape.ts";

export interface KeyButtonProps extends ComponentProps<"button"> {
  // 文言の前に置くアイコン(Lucide の size-5 など)
  icon?: ReactNode;
  // 文言の下に添える、押すと何が起きるかの短い説明
  detail?: ReactNode;
}

// PttButton の場所に置く、押して1回だけ働く大きなキー(「音声をつなぐ」など)。
// 点灯した琥珀のキーで、その画面の主な操作になる(primary と同じく1画面に1つ)。
// 押した後に PttButton と入れ替わっても、形が同じなので周りが動かない
export function KeyButton({ icon, detail, className, children, type = "button", ...props }: KeyButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        keyShapeClass,
        // 下の縁を濃くしてキーの厚みを出し、押すと沈める(Button の primary と同じ文法)
        "border-b-4 border-primary-hover bg-primary py-2 text-on-primary transition-[background-color,translate] duration-75 not-disabled:hover:bg-primary-hover not-disabled:active:translate-y-0.5 not-disabled:active:border-b-2",
        className,
      )}
      {...props}
    >
      {icon && <span className="flex shrink-0 [&>svg]:size-5">{icon}</span>}
      <span className="grid justify-items-start text-left">
        {children}
        {detail && <span className="text-sm font-medium opacity-80">{detail}</span>}
      </span>
    </button>
  );
}
