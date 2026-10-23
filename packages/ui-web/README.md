# @voice-intercom/ui-web

管理コンソール(`apps/admin`)と Web 版(`apps/web`)の UI 部品と、Tailwind の入口の CSS([styles.css](styles.css))。色などの値は [design-tokens](../design-tokens/README.md) から来る。

## 見た目の方向

無線機や放送卓の、キーと表示灯の文法を借りる。利用者は、いろいろな言語の人と現場でやり取りしている。片手で押して話し、訳された字幕を目で追う。

- **色の意味を守る。** 琥珀(`primary`)は「点灯したキー」で、画面の主な操作だけに使う。赤(`live`)は自分の送話(TX)、緑(`rx`)はほかの人の声の受信(RX)。この2つは通話の状態のためだけに使い、飾りや成功の印には使わない。
- **目立たせるのは1か所。** ルームの画面では PTT のキー(`key` の面)がいちばん重い。ほかの操作は `secondary` にして、キーと競わせない。
- **カードを並べない。** 同じ種類のものの並び(タイムライン、ルームの一覧)は、1枚の面を線で区切るか、線だけで区切る。`Card` は入力欄をまとめるときなど、まとまりに意味があるときに使う。
- **字幕は訳を大きく、原文を小さく。** 読むのは訳で、原文は確かめるために添える。
- **書体は IBM Plex Sans JP の1つ。** 太さ(400・500・700)と大きさで階層を作る。見出しは約物を詰める(`palt`)。数字は幅をそろえる(`tabular-nums`、body に指定済み)。
- **リンクは下線で示す。** 文字の色は変えない(琥珀は主な操作のために取っておく)。ただし、画面の題の上の戻るリンクはナビゲーションなので、下線を付けず ‹ を添えて薄く出す(`backLinkClass` と `BackIcon`)。
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
7. **ダイアログやメニューのような、フォーカスやキーボードの扱いが難しい部品は、見た目を持たない部品を下敷きにする。** 今は Radix(`@radix-ui/react-alert-dialog`)。版は固定し、出てから2週間以上たったものを使う。props は React Native でも作れる形にする(DOM のイベントや要素を props に出さない。開け閉めは `open` と `onXxx` のコールバック)。

## 部品

| 部品 | 使う場面 |
| --- | --- |
| `Button`、`buttonClass()` | 操作。`variant` は `primary`(画面の主な操作。1画面に1つ)、`secondary`(既定)、`ghost`(ヘッダーなど)、`danger`(削除)、`link`(文字だけ)。`icon` はアイコンだけの正方形のボタン(名前は `aria-label`)。`<Link>` をボタンの見た目にするときは `buttonClass()` |
| `Field` + `Input`・`Textarea`・`Select` | ラベル・説明(`hint`)・誤り(`error`)と入力欄の組。`id` と `aria-*` は `Field` が付ける |
| `Badge` | 短い状態の札。`tone` は `neutral`・`primary`・`success`・`warning`・`danger`・`live`(送話)・`rx`(受信) |
| `Alert` | 画面の中の知らせ。`tone` は `info`・`success`・`warning`・`danger`(`danger` は `role="alert"`)。`action` に再読み込みなどのボタン |
| `LoadErrorAlert` | 取得に失敗したことの知らせと「再読み込み」。無いもの・権限の無いものなど、読み込み直しても変わらないときは `retryable={false}` でボタンを出さない |
| `Card` | 地の上に置く面。`tone="danger"` は削除をまとめる面 |
| `Table`、`Th`、`Td` | 表。数値の列は `align="end"`、操作の列は `shrink` |
| `backLinkClass`、`BackIcon` | 一つ上の画面へ戻るリンク。ルーターの `<Link>` に `className={backLinkClass}` を付け、中に `<BackIcon />` と行き先の名前を置く。2つのアプリで同じ見た目にする |
| `AppHeader`、`appHeaderLinkClass`、`appHeaderTextClass` | アプリのいちばん上の帯。`brand`(アプリの名前。ホームへの `<Link>` でもよい)、`subtitle`、`badge`、`account`(右のアカウントの表示)、`onSignOut`。長い表示名やメールアドレスは省いて、ログアウトを押し出さない。`account` のリンクには `appHeaderLinkClass`、文字には `appHeaderTextClass` を付ける |
| `PageHeader` | 画面の題。`back`(戻るリンク)、`actions`(右の操作)、`description` |
| `FullScreenMessage` | 画面全体の真ん中の知らせ(読み込み中、ログインの失敗) |
| `ConfirmDialog` | 確定か取りやめかを選ばせるダイアログ(`window.confirm` は使わない)。`tone="danger"` は削除など取り返しのつかない操作(題に赤の表示灯、確定は `danger` のボタン)。`open` は呼び出し側が持ち、`onConfirm`・`onCancel` で閉じる。確定の文言は動詞で書く(「削除する」)。開くと取りやめにフォーカスを置き、Tab は中だけを回り、Esc で取りやめ、閉じると元のボタンにフォーカスを戻す |
| `PttButton` | PTT のキー。画面でいちばん大きく置く。`state` は `idle`(消灯)・`pressing`(琥珀。マイクの準備中)・`talking`(赤。送話中)。`shortcut` にキーボードの操作(`Space`)を添える |

## 見本帳(カタログ)

[catalog/](catalog/) は、部品とデザイントークンを一覧で見る開発用のアプリ(Vite + React。配信しない)。`mise run catalog` で起動し、`http://localhost:5175` を開く。明暗は左上で OS の設定・明・暗から選べる。

- 部品を足したり props を変えたりしたら、[catalog/src/sections/Components.tsx](catalog/src/sections/Components.tsx) に見本を足し、[catalog/src/App.tsx](catalog/src/App.tsx) の目次に載せる。
- 色・コントラスト比・角丸は design-tokens から読むので、トークンを変えれば見本も変わる(色を足すと、`bgClasses`・`textClasses` の書き足しを型の検査が求める)。
- カタログのコードも、この README の決まりと lint に従う。

## モバイル版(React Native)

モバイル版を作るときに `packages/ui-native` を足し、**同じ名前と props の部品**を React Native で作る。スタイルは Uniwind(React Native で Tailwind のクラスを使う)で、`design-tokens/generated/theme.css` を読み込む。クラスの書き方は Web とそろう。JS で色が要るとき(アイコンの色など)は `@voice-intercom/design-tokens/native` を使う。
