import { useId, useState, type ReactNode } from "react";

import { Button } from "./Button.tsx";
import { Checkbox } from "./Checkbox.tsx";
import { cx } from "./cx.ts";
import { Input } from "./Field.tsx";

export interface CheckboxListOption {
  value: string;
  // 絞り込みにも使うので文字列にする
  label: string;
  // ラベルの下に添える説明(話す言語など)
  description?: ReactNode;
}

export interface CheckboxListProps {
  legend: ReactNode;
  // 一覧の上に添える説明
  hint?: ReactNode;
  options: CheckboxListOption[];
  value: string[];
  onChange: (value: string[]) => void;
  // これより多ければ、名前で絞り込む欄を出す
  searchThreshold?: number;
  // 選んだ数の表示(「2人を選んでいます」など)
  selectedLabel?: (count: number) => ReactNode;
  // 選べるものが無いときの文
  emptyMessage?: ReactNode;
  // 絞り込んで1つも当てはまらないときの文
  noMatchMessage?: (query: string) => ReactNode;
  disabled?: boolean;
  className?: string;
}

// 複数を選ぶ一覧(一緒に入れる人など)。多いときは名前で絞り込め、一覧は枠の中でスクロールする。
// 選んだ数と「選択を外す」を一覧の上に出すので、絞り込んで隠れた分も分かる
export function CheckboxList({
  legend,
  hint,
  options,
  value,
  onChange,
  searchThreshold = 8,
  selectedLabel = (count) => `${count}件を選んでいます`,
  emptyMessage = "選べるものはありません。",
  noMatchMessage = (q) => `「${q}」に当てはまるものはありません。`,
  disabled,
  className,
}: CheckboxListProps) {
  const [query, setQuery] = useState("");
  const hintId = useId();
  const selected = new Set(value);
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle === "" ? options : options.filter((o) => o.label.toLocaleLowerCase().includes(needle));

  const toggle = (v: string, checked: boolean) => {
    // 並びは options の順に保つ
    onChange(options.map((o) => o.value).filter((x) => (x === v ? checked : selected.has(x))));
  };

  return (
    <fieldset className={cx("grid gap-2", className)} disabled={disabled} aria-describedby={hint ? hintId : undefined}>
      {/* legend は fieldset の最初の子にする(グループの名前として読ませるため) */}
      <legend className="text-sm font-medium">{legend}</legend>
      {(hint || value.length > 0) && (
        <div className="-mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {hint && (
            <p id={hintId} className="text-xs text-fg-muted">
              {hint}
            </p>
          )}
          {value.length > 0 && (
            <span className="ml-auto flex items-baseline gap-2 text-sm font-medium">
              {selectedLabel(value.length)}
              <Button variant="link" className="text-xs font-normal" onClick={() => onChange([])}>
                選択を外す
              </Button>
            </span>
          )}
        </div>
      )}
      {options.length === 0 ? (
        <p className="text-sm text-fg-muted">{emptyMessage}</p>
      ) : (
        <>
          {options.length > searchThreshold && (
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前で絞り込む"
              aria-label="名前で絞り込む"
            />
          )}
          <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border-strong bg-surface">
            {shown.map((o) => (
              <li key={o.value}>
                <Checkbox
                  // 行全体を押せるようにする(指でも押しやすい高さ)
                  className="w-full px-3 py-2.5 hover:bg-surface-muted"
                  label={o.label}
                  description={o.description}
                  checked={selected.has(o.value)}
                  onChange={(checked) => toggle(o.value, checked)}
                />
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-2.5 text-sm text-fg-muted">{noMatchMessage(query.trim())}</li>}
          </ul>
        </>
      )}
    </fieldset>
  );
}
