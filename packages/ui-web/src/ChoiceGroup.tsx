import type { ReactNode } from "react";

import { cx } from "./cx.ts";

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  // 選ぶと何が起きるか(1行で)
  description?: ReactNode;
  // label の前に置くアイコン
  icon?: ReactNode;
}

export interface ChoiceGroupProps<T extends string> {
  legend: ReactNode;
  // 同じ画面に2つ置くときに分ける、ラジオボタンの name
  name: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

// 少ない選択肢から1つを選ぶ(ルームの種別など)。選択肢ごとに説明を見せたいときに Select の代わりに使う。
// 中身はラジオボタンなので、矢印キーで選び直せる
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  className,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className={cx("grid gap-2", className)} disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <label
            key={o.value}
            className={cx(
              "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-fg",
              selected ? "border-fg bg-surface-muted" : "border-border-strong bg-surface hover:bg-surface-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onChange(o.value)}
              // 輪は label に描くので、ラジオボタンには描かない
              className="mt-1 size-4 shrink-0 accent-fg focus-visible:outline-none"
            />
            <span className="grid gap-0.5">
              <span className="flex items-center gap-1.5 font-bold">
                {o.icon}
                {o.label}
              </span>
              {o.description && <span className="text-sm text-fg-muted">{o.description}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
