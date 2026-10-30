import { View } from "react-native";

import { cx } from "./cx.ts";
import { Pulse } from "./pulse.tsx";

// off: 消灯(誰も話していない、待機中)。tx: 自分が送話中(赤)。rx: ほかの人の声を受信中(緑)
export type SignalState = "off" | "tx" | "rx";

const lampClasses: Record<SignalState, string> = {
  off: "bg-border-strong",
  tx: "bg-live",
  rx: "bg-rx",
};

export interface SignalLampProps {
  state: SignalState;
  className?: string;
}

// 通話の表示灯。いま声が流れているかを、文字の横に小さく灯す(灯りは飾りなので読み上げない。状態は文字で書く)
export function SignalLamp({ state, className }: SignalLampProps) {
  return (
    <Pulse active={state !== "off"}>
      <View
        accessible={false}
        importantForAccessibility="no"
        className={cx("size-2.5 shrink-0 rounded-full", lampClasses[state], className)}
      />
    </Pulse>
  );
}
