import type { ReactNode } from "react";
import { Modal, View } from "react-native";

import { Button } from "./Button.tsx";
import { cx } from "./cx.ts";
import { Text, wrapText } from "./Text.tsx";

// default: ふつうの確かめ(確定は primary のキー)。danger: 削除など取り返しのつかない操作(確定は danger のボタン)
export type ConfirmDialogTone = "default" | "danger";

export interface ConfirmDialogProps {
  // 開いているか。開け閉めは呼び出し側が持つ
  open: boolean;
  title: string;
  // 本文。何が起きるか(元に戻せるか)を書く
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  // 確定。呼び出し側で open を false にしてから処理を始める
  onConfirm: () => void;
  // 取りやめ(取りやめのボタン、Android の戻るキー)。呼び出し側で open を false にする
  onCancel: () => void;
}

// 確認のダイアログ。後ろの幕を押しても閉じない(選ばせる)。確定を上(親指の届く順)に置く
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "やめる",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-overlay p-4">
        <View
          accessibilityViewIsModal
          className={cx("w-full max-w-md gap-4 rounded-lg border bg-surface p-5", tone === "danger" ? "border-danger" : "border-border")}
        >
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              {/* 危ない操作には赤の表示灯を点ける(文字だけでも分かるよう、色だけに頼らない) */}
              {tone === "danger" && <View className="size-2.5 shrink-0 rounded-full bg-danger" />}
              <Text accessibilityRole="header" className="flex-1 font-bold">
                {title}
              </Text>
            </View>
            {description !== undefined && wrapText(description, "text-sm leading-relaxed text-fg-muted")}
          </View>
          <View className="gap-2">
            <Button variant={tone === "danger" ? "danger" : "primary"} onPress={onConfirm}>
              {confirmLabel}
            </Button>
            <Button onPress={onCancel}>{cancelLabel}</Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
