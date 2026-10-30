import type { ReactNode } from "react";

import { Alert } from "./Alert.tsx";
import { Button } from "./Button.tsx";

export interface LoadErrorAlertProps {
  // 何を取得できなかったかと、その理由
  children: ReactNode;
  onRetry: () => void;
  // 読み込み直しても変わらないとき(無いもの、権限が無いもの)は false にして、ボタンを出さない
  retryable?: boolean;
  className?: string;
}

// 取得に失敗したことの知らせと、読み込み直すボタン
export function LoadErrorAlert({ children, onRetry, retryable = true, className }: LoadErrorAlertProps) {
  return (
    <Alert
      tone="danger"
      className={className}
      action={
        retryable && (
          <Button size="sm" onPress={onRetry}>
            再読み込み
          </Button>
        )
      }
    >
      {children}
    </Alert>
  );
}
