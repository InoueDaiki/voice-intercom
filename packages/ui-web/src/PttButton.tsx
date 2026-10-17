import type { ComponentProps, ReactNode } from "react";

import { cx } from "./cx.ts";

// idle: 押していない。pressing: 押したが、まだ声を送れていない(マイクの準備中)。talking: 送話中
export type PttState = "idle" | "pressing" | "talking";

// 無線機のキーと表示灯の文法: 押していなければ消灯したキー、押したら琥珀に灯り、声を送れたら赤(TX)
const stateClasses: Record<PttState, { button: string; lamp: string }> = {
  idle: {
    button: "bg-key text-on-key not-disabled:hover:bg-key-hover",
    lamp: "bg-on-key/30",
  },
  pressing: {
    button: "translate-y-0.5 bg-primary text-on-primary",
    lamp: "bg-on-primary motion-safe:animate-pulse",
  },
  talking: {
    button: "translate-y-0.5 bg-live text-on-live",
    lamp: "bg-on-live motion-safe:animate-pulse",
  },
};

export interface PttButtonProps extends ComponentProps<"button"> {
  state: PttState;
  // 右の端に添える、キーボードの操作(Space など)。幅の狭い画面では出さない
  shortcut?: ReactNode;
}

// PTT(押している間だけ話す)のキー。画面でいちばん大きく、押している間は沈んで灯る。
// 押す・離すの処理は呼び出し側で付ける
export function PttButton({ state, shortcut, className, children, ...props }: PttButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        // 状態で文言が変わっても幅が変わらないよう、最小の幅を取る
        "relative flex min-h-16 min-w-56 touch-none items-center justify-center gap-3 rounded-xl px-6 text-lg font-bold transition-[background-color,translate] duration-75 select-none disabled:cursor-not-allowed disabled:opacity-50",
        stateClasses[state].button,
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cx("size-3 shrink-0 rounded-full", stateClasses[state].lamp)} />
      {children}
      {shortcut && (
        <kbd className="absolute right-4 hidden rounded-sm border border-current/40 px-1.5 py-0.5 font-sans text-xs font-medium opacity-70 sm:block">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
