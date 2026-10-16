// クラス名をつなぐ。偽の値は飛ばす
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
