import type { ColorName } from "@voice-intercom/design-tokens/native";
import type { LucideIcon } from "lucide-react-native";

import { useForeground, useTokenColor } from "./foreground.tsx";

export interface IconProps {
  // Lucide のアイコン(lucide-react-native。名前は Web の lucide-react と同じ)
  icon: LucideIcon;
  // 一辺(px)。Web の size-4 は 16、size-5 は 20
  size?: number;
  // 色のトークン。無ければ周り(ボタンや札)の色
  color?: ColorName;
  // 名前。飾りなら付けない(読み上げない)
  accessibilityLabel?: string;
}

// アイコン。色はクラスではなくトークンの名前で渡す(SVG の色は style で決まらないため)
export function Icon({ icon: Component, size = 16, color, accessibilityLabel }: IconProps) {
  const fg = useForeground();
  const value = useTokenColor(color ?? fg.color);
  return (
    <Component
      size={size}
      color={value}
      accessible={accessibilityLabel !== undefined}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
