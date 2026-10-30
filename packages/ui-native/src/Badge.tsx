import type { ColorName } from "@voice-intercom/design-tokens/native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { cx } from "./cx.ts";
import { ForegroundProvider } from "./foreground.tsx";
import { wrapText } from "./Text.tsx";

// neutral: 件数や種類などの添え書き。live: 送話中(TX)。rx: 受信中
export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "live" | "rx";

const toneClasses: Record<BadgeTone, { box: string; text: string }> = {
  neutral: { box: "bg-surface-muted", text: "text-fg-muted" },
  primary: { box: "bg-primary-soft", text: "text-primary-fg" },
  success: { box: "bg-success-soft", text: "text-success-fg" },
  warning: { box: "bg-warning-soft", text: "text-warning-fg" },
  danger: { box: "bg-danger-soft", text: "text-danger-fg" },
  live: { box: "bg-live", text: "text-on-live" },
  rx: { box: "bg-rx-soft", text: "text-rx-fg" },
};

// アイコンの色(クラスでは決められないので、トークンの名前で持つ)
const toneColors: Record<BadgeTone, ColorName> = {
  neutral: "fg-muted",
  primary: "primary-fg",
  success: "success-fg",
  warning: "warning-fg",
  danger: "danger-fg",
  live: "on-live",
  rx: "rx-fg",
};

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  // 文字と、小さなアイコン(<Icon size={14}>)
  children: ReactNode;
}

// 短い状態の札(人数、翻訳ありなど)
export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  const t = toneClasses[tone];
  return (
    <View className={cx("flex-row items-center gap-1 rounded-sm px-1.5 py-0.5", t.box, className)}>
      <ForegroundProvider value={{ textClass: cx("text-xs font-medium", t.text), color: toneColors[tone] }}>
        {wrapText(children)}
      </ForegroundProvider>
    </View>
  );
}
