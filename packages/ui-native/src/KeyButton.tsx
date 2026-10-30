import type { ReactNode } from "react";
import { Pressable, type PressableProps, View } from "react-native";

import { cx } from "./cx.ts";
import { ForegroundProvider } from "./foreground.tsx";
import { keyShapeClass, keyTextClass } from "./keyShape.ts";
import { Text } from "./Text.tsx";

export interface KeyButtonProps extends Omit<PressableProps, "children" | "style"> {
  // 文言の前に置くアイコン(<Icon size={20}>)
  icon?: ReactNode;
  // 文言の下に添える、押すと何が起きるかの短い説明
  detail?: ReactNode;
  className?: string;
  children: ReactNode;
}

// PttButton の場所に置く、押して1回だけ働く大きなキー(「音声をつなぐ」など)。
// 点灯した琥珀のキーで、その画面の主な操作になる(primary と同じく1画面に1つ)。
// 押した後に PttButton と入れ替わっても、形が同じなので周りが動かない
export function KeyButton({ icon, detail, className, disabled, children, ...props }: KeyButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      className={cx(
        keyShapeClass,
        // 下の縁を濃くしてキーの厚みを出し、押すと沈める(Button の primary と同じ文法)
        "border-b-4 border-primary-hover bg-primary py-2 active:translate-y-0.5 active:border-b-2",
        disabled && "opacity-50",
        className,
      )}
      {...props}
    >
      <ForegroundProvider value={{ textClass: cx(keyTextClass, "text-on-primary"), color: "on-primary" }}>
        {icon}
        <View className="items-start">
          <Text>{children}</Text>
          {detail && <Text className="text-sm font-medium opacity-80">{detail}</Text>}
        </View>
      </ForegroundProvider>
    </Pressable>
  );
}
