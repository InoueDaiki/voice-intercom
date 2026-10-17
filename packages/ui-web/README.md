# @voice-intercom/ui-web

管理コンソール(`apps/admin`)と Web 版(`apps/web`)の UI 部品と、Tailwind の入口の CSS([styles.css](styles.css))。色などの値は [design-tokens](../design-tokens/README.md) から来る。

## 見た目の方向

無線機や放送卓の、キーと表示灯の文法を借りる。利用者は、いろいろな言語の人と現場でやり取りしている。片手で押して話し、訳された字幕を目で追う。

- **色の意味を守る。** 琥珀(`primary`)は「点灯したキー」で、画面の主な操作だけに使う。赤(`live`)は自分の送話(TX)、緑(`rx`)はほかの人の声の受信(RX)。この2つは通話の状態のためだけに使い、飾りや成功の印には使わない。
- **目立たせるのは1か所。** ルームの画面では PTT のキー(`key` の面)がいちばん重い。ほかの操作は `secondary` にして、キーと競わせない。
- **カードを並べない。** 同じ種類のものの並び(タイムライン、ルームの一覧)は、1枚の面を線で区切るか、線だけで区切る。`Card` は入力欄をまとめるときなど、まとまりに意味があるときに使う。
- **字幕は訳を大きく、原文を小さく。** 読むのは訳で、原文は確かめるために添える。
- **書体は IBM Plex Sans JP の1つ。** 太さ(400・500・700)と大きさで階層を作る。見出しは約物を詰める(`palt`)。数字は幅をそろえる(`tabular-nums`、body に指定済み)。
- **リンクは下線で示す。** 文字の色は変えない(琥珀は主な操作のために取っておく)。
- **フォーカスの輪は `fg`。** 琥珀は白い地の上で見えにくいため。

## 画面を書くときの決まり

人も AI もこの決まりで書く。`mise run lint` の `pnpm lint:design`(oxlint。設定は [/.oxlintrc.json](../../.oxlintrc.json))が守れていないものを落とす。

1. **まず部品を使う。** ボタン・入力欄・札・知らせ・表・カード・画面の題は、下の部品を使う。`<button>` や `<input>` に直にクラスを付けない。
2. **見た目は Tailwind のクラスで書く。** CSS のファイルを足さない。各アプリの `src/index.css` は `styles.css` を読み込むだけにする。
3. **色はトークンの名前だけを使う。** `bg-surface`、`text-fg-muted`、`border-border` のように書く。一覧は [TOKENS.md](../design-tokens/generated/TOKENS.md)。
   - Tailwind の既定の色(`bg-red-500`、`text-white` など)は消してあり、使うと lint が落とす(`no-unknown-classes`)。
   - `text-[#fff]`、`rounded-[3px]` のような任意の値で色・角丸・書体を決めない(`no-restricted-classes`)。余白や幅の任意の値(`grid-cols-[auto_1fr]` など)は使ってよい。
   - `dark:` は書かない。トークンが明暗を切り替える。
   - HEX や `rgb()` などの色を文字列に書かない。`style` で色・線・影を決めない(`design/no-raw-color`、`design/no-style-color`)。縦横比のように、値で決まるものだけを `style` に書く。
4. **クラスを変数に入れるときは、名前を `...Class` か `...Classes` で終える。** lint がその中身も検査する。条件で付け外しするときは `cx()` を使う。
5. **アイコンは Lucide を使う。** Web は `lucide-react`、モバイル版は `lucide-react-native`(名前が同じ)。絵文字をアイコンの代わりにしない。
6. **足りない部品は、ここに足す。** 2つのアプリで使うもの、モバイル版にも要るものはここに置く。1画面でしか使わないもの(タイムラインの1件など)は、そのアプリに置いてよい。

## 部品

| 部品 | 使う場面 |
| --- | --- |
| `Button`、`buttonClass()` | 操作。`variant` は `primary`(画面の主な操作。1画面に1つ)、`secondary`(既定)、`ghost`(ヘッダーなど)、`danger`(削除)、`link`(文字だけ)。`<Link>` をボタンの見た目にするときは `buttonClass()` |
| `Field` + `Input`・`Textarea`・`Select` | ラベル・説明(`hint`)・誤り(`error`)と入力欄の組。`id` と `aria-*` は `Field` が付ける |
| `Badge` | 短い状態の札。`tone` は `neutral`・`primary`・`success`・`warning`・`danger`・`live`(送話)・`rx`(受信) |
| `Alert` | 画面の中の知らせ。`tone` は `info`・`success`・`warning`・`danger`(`danger` は `role="alert"`)。`action` に再読み込みなどのボタン |
| `Card` | 地の上に置く面。`tone="danger"` は削除をまとめる面 |
| `Table`、`Th`、`Td` | 表。数値の列は `align="end"`、操作の列は `shrink` |
| `PageHeader` | 画面の題。`back`(戻るリンク)、`actions`(右の操作)、`description` |
| `FullScreenMessage` | 画面全体の真ん中の知らせ(読み込み中、ログインの失敗) |
| `PttButton` | PTT のキー。画面でいちばん大きく置く。`state` は `idle`(消灯)・`pressing`(琥珀。マイクの準備中)・`talking`(赤。送話中)。`shortcut` にキーボードの操作(`Space`)を添える |

## モバイル版(React Native)

モバイル版を作るときに `packages/ui-native` を足し、**同じ名前と props の部品**を React Native で作る。スタイルは Uniwind(React Native で Tailwind のクラスを使う)で、`design-tokens/generated/theme.css` を読み込む。クラスの書き方は Web とそろう。JS で色が要るとき(アイコンの色など)は `@voice-intercom/design-tokens/native` を使う。
