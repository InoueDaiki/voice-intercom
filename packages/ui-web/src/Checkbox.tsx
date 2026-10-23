import type { ReactNode } from "react";

import { cx } from "./cx.ts";

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  // ラベルの下に添える説明
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

// ラベル付きのチェックボックス。複数を選ぶ一覧(一緒に入れる人など)に並べる
export function Checkbox({ label, checked, onChange, description, disabled, className }: CheckboxProps) {
  return (
    <label
      className={cx(
        "flex w-fit cursor-pointer items-start gap-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
      />
      <span className="grid gap-0.5">
        {label}
        {description && <span className="text-xs text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}
