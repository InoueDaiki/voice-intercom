import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useRef, type ReactNode } from "react";

import { Button } from "./Button.tsx";
import { cx } from "./cx.ts";

// default: ふつうの確かめ(確定は primary のキー)。danger: 削除など取り返しのつかない操作(確定は danger のボタン)
export type ConfirmDialogTone = "default" | "danger";

export interface ConfirmDialogProps {
  // 開いているか。開け閉めは呼び出し側が持つ(ui-native では Modal の visible に当てる)
  open: boolean;
  title: string;
  // 本文。何が起きるか(元に戻せるか)を書く。ui-native でも描けるよう、文字列か文字列の並びにする
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  // 確定。呼び出し側で open を false にしてから処理を始める(待っている間の表示は元の画面に出す)
  onConfirm: () => void;
  // 取りやめ(取りやめのボタン、Esc。ui-native では Android の戻るキー)。呼び出し側で open を false にする
  onCancel: () => void;
}

// 確認のダイアログ。Radix の AlertDialog(見た目を持たない部品)を下敷きにする。
// - 開くと取りやめのボタンにフォーカスを置く(Enter をうっかり押しても消えない)
// - Tab は中だけを回り、Esc で取りやめる。後ろの幕を押しても閉じない(選ばせる)
// - 閉じると、開く前にフォーカスのあった要素(削除のボタンなど)に戻す
// - role="alertdialog" で、題と本文を aria-labelledby・aria-describedby で結ぶ
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
  // 開く前にフォーカスのあった要素。Radix は Trigger を使わないと、閉じたときにフォーカスを戻さない
  // (開け閉めを呼び出し側が持つので、Trigger は使わない)
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel();
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-overlay transition-opacity duration-150 starting:opacity-0" />
        <AlertDialog.Content
          // 本文がなければ aria-describedby を付けない(Radix の警告を出さない)
          {...(description === undefined ? { "aria-describedby": undefined } : {})}
          onOpenAutoFocus={() => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // 消した行のボタンのように、もう画面に無ければ戻さない
            if (returnFocusRef.current?.isConnected) {
              returnFocusRef.current.focus();
            }
            returnFocusRef.current = null;
          }}
          className={cx(
            "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-1/2 gap-4 rounded-lg border bg-surface p-5 text-fg transition-[opacity,scale] duration-150 starting:scale-95 starting:opacity-0",
            tone === "danger" ? "border-danger" : "border-border",
          )}
        >
          <div className="grid gap-2">
            <AlertDialog.Title className="flex items-center gap-2 text-base font-bold">
              {/* 危ない操作には赤の表示灯を点ける(文字だけでも分かるよう、色だけに頼らない) */}
              {tone === "danger" && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-danger" />}
              {title}
            </AlertDialog.Title>
            {description !== undefined && (
              <AlertDialog.Description className="text-sm leading-relaxed text-fg-muted">
                {description}
              </AlertDialog.Description>
            )}
          </div>
          {/* 幅の狭い画面では縦に並べ、確定を上(親指の届く順)に置く */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button>{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
