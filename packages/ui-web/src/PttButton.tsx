import type { ComponentProps } from "react";

import { cx } from "./cx.ts";

// idle: 押していない。pressing: 押したが、まだ声を送れていない(マイクの準備中)。talking: 送話中
export type PttState = "idle" | "pressing" | "talking";

const stateClasses: Record<PttState, { button: string; dot: string }> = {
  idle: {
    button: "border-border-strong bg-surface text-fg not-disabled:hover:bg-surface-muted",
    dot: "bg-border-strong",
  },
  pressing: {
    button: "border-warning bg-warning-soft text-fg",
    dot: "bg-warning",
  },
  talking: {
    button: "border-live bg-live text-on-live",
    dot: "animate-pulse bg-on-live",
  },
};

export interface PttButtonProps extends ComponentProps<"button"> {
  state: PttState;
}

// PTT(押している間だけ話す)のボタン。押す・離すの処理は呼び出し側で付ける
export function PttButton({ state, className, children, ...props }: PttButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        // 状態で文言が変わっても幅が変わらないよう、最小の幅を取る
        "flex min-h-14 min-w-52 touch-none items-center justify-center gap-2 rounded-xl border-2 px-5 py-3 text-base font-semibold transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50",
        stateClasses[state].button,
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cx("size-2.5 shrink-0 rounded-full", stateClasses[state].dot)} />
      {children}
    </button>
  );
}
