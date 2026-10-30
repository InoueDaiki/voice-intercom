# @voice-intercom/ui-native

モバイル版(`apps/mobile`)の UI 部品。ui-web と同じ名前と props で作り、[Uniwind](https://docs.uniwind.dev/) で Tailwind のクラスを書く。色などの値は [design-tokens](../design-tokens/README.md) から来る(`theme.css` を Web と共有する)。

見た目の方向と、画面を書くときの決まりは [ui-web の README](../ui-web/README.md) と同じ。`mise run lint` の `pnpm lint:design` が、このパッケージとモバイル版も検査する。

## ui-web との違い

React Native には DOM が無いので、次のところだけ変えてある。

- **文字は必ず `Text` に書く。** React Native は文字の色や大きさを親から引き継がない。`Text` は既定で `text-base` と周りの色を付ける。`Text` の中の `Text` は親を引き継ぐ。
  - ボタンや札の中では、文字列をそのまま書いてよい(部品が `Text` に包む)。
- **アイコンは `<Icon icon={Mic} />`。** SVG の色はクラスで決まらないので、色はトークンの名前で渡す(`color="fg-muted"`)。渡さなければ、周り(ボタンや札)の色になる。大きさは px(Web の `size-4` は 16)。
- **イベントは React Native の名前。** `onClick` ではなく `onPress`。押している間だけのもの(PTT)は `onPressIn` と `onPressOut`。入力欄は `onChangeText`。
- **読み上げは `accessibility*`。** `aria-label` ではなく `accessibilityLabel`、`title` の代わりに `accessibilityHint`。
- **`cx` はぶつかるクラスを後ろのもので上書きする**(tailwind-merge)。部品が既定のクラスを付け、呼び出し側が `className` で変えられるようにするため。
- **書体は `Text` と入力欄が当てる**(IBM Plex Sans JP。アプリが expo-font で埋め込む)。太さは 400・500・700 で、`font-medium`・`font-bold` のクラスから決まる。太さごとに別の書体として指すので、`style` で `fontWeight` を決めない。ナビゲーションのヘッダーなど、クラスを書けないところは `fontStyle()` を使う。
- **`Select` は `options` で選択肢を渡す**(`<option>` が無いため)。押すと一覧を画面に重ねて出す。
- **無いもの:** `Table`(管理コンソールだけで使う)、`buttonClass`・`backLinkClass`・`BackIcon`(リンクは Expo Router の `<Link asChild>` でボタンを包む。戻る操作はナビゲーションのヘッダーが持つ)、`AppHeader`(上の帯はナビゲーションのヘッダーを同じ色にする)。`PageHeader` の `back` も無い。
- **灯りの明滅は `Animated`**(OS で動きを減らす設定なら明滅しない)。
- **安全な領域**(ノッチ、ホームのバー)は Uniwind のクラスで避ける(`pb-safe`、`pb-safe-or-4` など)。

## 部品

名前と使う場面は [ui-web の一覧](../ui-web/README.md#部品)と同じ。ここで足したものだけを書く。

| 部品 | 使う場面 |
| --- | --- |
| `Text`、`wrapText()` | 文字。`wrapText` は、子のうち文字列を `Text` に包む(部品を作るときに使う) |
| `Icon` | Lucide のアイコン(`lucide-react-native`)。`color` はトークンの名前 |
| `ForegroundProvider`、`useForeground()` | 中の `Text` と `Icon` の色を決める(Web の `currentColor` の代わり)。部品を作るときに使う |
| `useTokenColor()` | トークンの色の値(OS の明暗に合わせる)。クラスを書けないところ(ナビゲーションのヘッダー、入力欄の placeholder)で使う |
