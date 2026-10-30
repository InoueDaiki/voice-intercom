import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { cx } from "./cx.ts";
import { wrapText } from "./Text.tsx";

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  // 選ぶと何が起きるか(1行で)
  description?: ReactNode;
  // label の前に置くアイコン(<Icon>)
  icon?: ReactNode;
}

export interface ChoiceGroupProps<T extends string> {
  legend: ReactNode;
  // ui-web と props をそろえるために受け取る(React Native では使わない)
  name?: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

// 少ない選択肢から1つを選ぶ(ルームの種別など)。選択肢ごとに説明を見せたいときに Select の代わりに使う。
// 読み上げではラジオボタンとして扱う
export function ChoiceGroup<T extends string>({ legend, value, options, onChange, disabled, className }: ChoiceGroupProps<T>) {
  return (
    <View accessibilityRole="radiogroup" className={cx("gap-2", className)}>
      {wrapText(legend, "mb-1.5 text-sm font-medium")}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            className={cx(
              "flex-row items-start gap-3 rounded-md border px-3 py-2",
              selected ? "border-fg bg-surface-muted" : "border-border-strong bg-surface active:bg-surface-muted",
              disabled && "opacity-50",
            )}
          >
            <View className={cx("mt-1 size-4 items-center justify-center rounded-full border", selected ? "border-fg" : "border-border-strong")}>
              {selected && <View className="size-2 rounded-full bg-fg" />}
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row items-center gap-1.5">
                {o.icon}
                {wrapText(o.label, "font-bold")}
              </View>
              {o.description && wrapText(o.description, "text-sm text-fg-muted")}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

