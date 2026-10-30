import type { ColorName } from "@voice-intercom/design-tokens/native";
import type { ReactNode } from "react";
import { Pressable, type PressableProps, View } from "react-native";

import { cx } from "./cx.ts";
import { ForegroundProvider } from "./foreground.tsx";
import { keyShapeClass, keyTextClass } from "./keyShape.ts";
import { Pulse } from "./pulse.tsx";
import { wrapText } from "./Text.tsx";

// idle: 押していない。pressing: 押したが、まだ声を送れていない(マイクの準備中)。talking: 送話中
export type PttState = "idle" | "pressing" | "talking";

// 無線機のキーと表示灯の文法: 押していなければ消灯したキー、押したら琥珀に灯り、声を送れたら赤(TX)
const stateClasses: Record<PttState, { button: string; text: string; lamp: string }> = {
  idle: { button: "bg-key active:bg-key-hover", text: "text-on-key", lamp: "bg-on-key/30" },
  pressing: { button: "translate-y-0.5 bg-primary", text: "text-on-primary", lamp: "bg-on-primary" },
  talking: { button: "translate-y-0.5 bg-live", text: "text-on-live", lamp: "bg-on-live" },
};

// アイコンの色(クラスでは決められないので、トークンの名前で持つ)
const stateColors: Record<PttState, ColorName> = {
  idle: "on-key",
  pressing: "on-primary",
  talking: "on-live",
};

export interface PttButtonProps extends Omit<PressableProps, "children" | "style"> {
  state: PttState;
  // ui-web と props をそろえるために受け取る(キーボードの操作。モバイル版では出さない)
  shortcut?: ReactNode;
  className?: string;
  children: ReactNode;
}

// PTT(押している間だけ話す)のキー。画面でいちばん大きく、押している間は沈んで灯る。
// 押す・離すの処理は呼び出し側で付ける(onPressIn・onPressOut)
export function PttButton({ state, shortcut: _shortcut, className, disabled, children, ...props }: PttButtonProps) {
  const s = stateClasses[state];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: state !== "idle" }}
      disabled={disabled}
      // 押している間に指が少しずれても離さない
      pressRetentionOffset={{ top: 80, bottom: 80, left: 80, right: 80 }}
      className={cx(keyShapeClass, s.button, disabled && "opacity-50", className)}
      {...props}
    >
      <Pulse active={state !== "idle"}>
        <View className={cx("size-3 shrink-0 rounded-full", s.lamp)} />
      </Pulse>
      <ForegroundProvider value={{ textClass: cx(keyTextClass, s.text), color: stateColors[state] }}>{wrapText(children)}</ForegroundProvider>
    </Pressable>
  );
}
