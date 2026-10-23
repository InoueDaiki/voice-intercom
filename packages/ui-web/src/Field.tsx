import { createContext, use, useId, type ComponentProps, type ReactNode } from "react";

import { cx } from "./cx.ts";

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface FieldProps {
  label: ReactNode;
  // 入力の説明(文字数、書き方)
  hint?: ReactNode;
  // 誤り。あれば入力欄を誤りの見た目にし、読み上げで説明として読ませる
  error?: ReactNode;
  className?: string;
  // Input・Textarea・Select を1つ入れる。id と aria の属性は Field が付ける
  children: ReactNode;
}

// ラベル・説明・誤りと、入力欄1つの組
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("grid content-start gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <FieldContext value={{ id, describedBy, invalid: !!error }}>{children}</FieldContext>
      {hint && (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}

const controlClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 text-base text-fg placeholder:text-fg-muted focus-visible:border-fg focus-visible:outline-1 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger sm:text-sm";

// Field の中なら、id・説明・誤りの属性を足す(props で渡したものが先)
function useFieldProps<P extends { id?: string; "aria-describedby"?: string; "aria-invalid"?: ComponentProps<"input">["aria-invalid"] }>(
  props: P,
): P {
  const field = use(FieldContext);
  if (!field) {
    return props;
  }
  return {
    ...props,
    id: props.id ?? field.id,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
  };
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(controlClass, "h-10", className)} {...useFieldProps(props)} />;
}

// 上下の余白は、1行(rows={1})のときに Input と同じ高さ(h-10)になるよう、行の高さから決める。
// 幅の狭い画面と広い画面で文字の大きさが違っても、どちらでもそろう
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(controlClass, "py-[calc((--spacing(10)-2px-1lh)/2)] leading-relaxed", className)}
      {...useFieldProps(props)}
    />
  );
}

// 矢印はブラウザのものを消して自前で描く(ブラウザの矢印は枠の右端に寄りすぎ、位置も変えられない)
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cx(controlClass, "peer h-10 appearance-none pr-10", className)} {...useFieldProps(props)} />
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted peer-disabled:opacity-50"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </div>
  );
}
