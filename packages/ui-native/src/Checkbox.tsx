import { Check } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";
import { wrapText } from "./Text.tsx";

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  // ラベルの下に添える説明
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

// ラベル付きのチェックボックス。複数を選ぶ一覧(一緒に入れる人など)に並べる。行全体を押せる
export function Checkbox({ label, checked, onChange, description, disabled, className }: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      className={cx("flex-row items-start gap-2", disabled && "opacity-50", className)}
    >
      <View
        className={cx(
          "mt-0.5 size-5 items-center justify-center rounded-sm border",
          checked ? "border-fg bg-fg" : "border-border-strong bg-surface",
        )}
      >
        {checked && <Icon icon={Check} size={14} color="surface" />}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        {wrapText(label, "text-sm")}
        {description && wrapText(description, "text-xs text-fg-muted")}
      </View>
    </Pressable>
  );
}
