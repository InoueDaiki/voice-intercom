# @voice-intercom/design-tokens

管理コンソール、Web 版、モバイル版で共有するデザイントークン(色、角丸、書体)。正は [src/tokens.ts](src/tokens.ts) で、`mise run gen:tokens` で `generated/` を作る(生成物は手で編集せずにコミットする)。

| 生成物 | 使う所 |
| --- | --- |
| [generated/theme.css](generated/theme.css) | Tailwind v4 のテーマ。`packages/ui-web/styles.css` が読み込む。React Native の Uniwind でも読める形(`@layer theme` の中の `@variant dark`)にしてある(Uniwind ではまだ試していない) |
| [generated/native.ts](generated/native.ts) | React Native で JS から色を使うとき(アイコンの色、アニメーションなど)。`@voice-intercom/design-tokens/native` |
| [generated/TOKENS.md](generated/TOKENS.md) | トークンの一覧と使う場面。名前を選ぶときに読む |

## 決まり

- **色は役割の名前で持つ。** 「青」ではなく「主な操作(`primary`)」「補足の文字(`fg-muted`)」のように名前を付け、画面ではこの名前だけを使う。
- **明暗の両方の値を持つ。** OS の設定(`prefers-color-scheme`)で切り替える。画面で `dark:` は書かない。
- **色は OKLCH で書く。** 明るさをそろえて色相を変えやすいため。React Native は OKLCH を解釈できないので、`native.ts` には HEX に変換して出す。
- **テストで確かめる**(`src/tokens.test.ts`、`mise run test:js` で動く)。
  - どの色も sRGB に収まる(収まらないと、Web と React Native で見え方がずれる)。
  - 文字と地の組み合わせ(`contrastPairs`)が WCAG 2 の AA のコントラスト比(本文 4.5、線 3)を満たす。組み合わせを足したら `contrastPairs` にも足す。
- **余白と文字の大きさは Tailwind の既定を使う。** Uniwind も同じ物差しなので、Web とモバイルで同じクラスになる。

## トークンを足す・変える

1. `src/tokens.ts` の `colors` に足す(`light`・`dark`・`usage`)。文字に使う色なら `contrastPairs` にも足す。
2. `mise run gen:tokens` を実行し、`generated/` をコミットする。
3. `mise run test:js` で範囲とコントラスト比を確かめる。
