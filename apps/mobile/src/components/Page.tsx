import type { ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";

// ルームの画面以外の、本文の枠。スクロールでき、幅の広い画面(iPad)では真ん中に寄せる。
// onRefresh を渡すと、引き下げて読み直せる
export function Page({
  children,
  refreshing = false,
  onRefresh,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="w-full max-w-3xl gap-8 self-center px-4 pt-6 pb-12"
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh && <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {children}
    </ScrollView>
  );
}
