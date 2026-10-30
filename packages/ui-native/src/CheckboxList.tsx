import { type ReactNode, useState } from "react";
import { ScrollView, View } from "react-native";

import { Button } from "./Button.tsx";
import { Checkbox } from "./Checkbox.tsx";
import { cx } from "./cx.ts";
import { Input } from "./Field.tsx";
import { Text, wrapText } from "./Text.tsx";

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
  const selected = new Set(value);
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle === "" ? options : options.filter((o) => o.label.toLocaleLowerCase().includes(needle));

  const toggle = (v: string, checked: boolean) => {
    // 並びは options の順に保つ
    onChange(options.map((o) => o.value).filter((x) => (x === v ? checked : selected.has(x))));
  };

  return (
    <View className={cx("gap-2", className)}>
      {wrapText(legend, "text-sm font-medium")}
      {(hint || value.length > 0) && (
        <View className="-mt-1 flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {hint && wrapText(hint, "text-xs text-fg-muted")}
          {value.length > 0 && (
            <View className="ml-auto flex-row items-baseline gap-2">
              {wrapText(selectedLabel(value.length), "text-sm font-medium")}
              <Button variant="link" textClassName="text-xs font-normal" disabled={disabled} onPress={() => onChange([])}>
                選択を外す
              </Button>
            </View>
          )}
        </View>
      )}
      {options.length === 0 ? (
        wrapText(emptyMessage, "text-sm text-fg-muted")
      ) : (
        <>
          {options.length > searchThreshold && (
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="名前で絞り込む"
              accessibilityLabel="名前で絞り込む"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!disabled}
            />
          )}
          <View className="max-h-64 overflow-hidden rounded-md border border-border-strong bg-surface">
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {shown.map((o, i) => (
                <Checkbox
                  key={o.value}
                  // 行全体を押せるようにする(指でも押しやすい高さ)
                  className={cx("w-full px-3 py-3 active:bg-surface-muted", i > 0 && "border-t border-border")}
                  label={o.label}
                  description={o.description}
                  checked={selected.has(o.value)}
                  disabled={disabled}
                  onChange={(checked) => toggle(o.value, checked)}
                />
              ))}
              {shown.length === 0 && <Text className="px-3 py-3 text-sm text-fg-muted">{noMatchMessage(query.trim())}</Text>}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
}
