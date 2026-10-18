// cancel して渡し直すときの、残りの文の切り出し。DOM を使わない。

/**
 * boundary イベントの `charIndex`(読んでいる語の先頭)から後ろを返す。
 * 読んでいる途中の語は頭から読み直す。範囲の外なら空文字を返す。
 */
export function remainingText(text: string, charIndex: number | null): string {
  if (charIndex === null) return text;
  if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex >= text.length) return "";
  return text.slice(Math.floor(charIndex)).trimStart();
}

/**
 * boundary が届かない声で、経過時間から見積もった位置を語の先頭に戻す。
 * 空白の無い文(日本語・中国語)では、見積もった位置をそのまま使う。
 */
export function snapToWordStart(text: string, index: number): number {
  const i = Math.max(0, Math.min(text.length, Math.floor(index)));
  if (!/\s/u.test(text)) return i;
  let j = i;
  while (j > 0 && !/\s/u.test(text[j - 1] as string)) j -= 1;
  return j;
}
