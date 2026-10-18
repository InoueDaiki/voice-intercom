<!-- 生成物。packages/design-tokens/src/tokens.ts から `mise run gen:tokens` で作る。手で編集しない -->

# デザイントークン

色は役割の名前で選ぶ。Tailwind のクラスでは `bg-<名前>`、`text-<名前>`、`border-<名前>` のように書く(例: `bg-surface text-fg border-border`)。明暗は OS の設定で自動で切り替わるので、`dark:` は書かない。

## 色

| 名前 | 使う場面 | 明 | 暗 |
| --- | --- | --- | --- |
| `canvas` | ページの地(body) | `#f1f3f5` | `#0f1318` |
| `surface` | 表、入力欄、ヘッダー、操作の台など、地の上に置く面 | `#ffffff` | `#171c22` |
| `surface-muted` | 控えめな塗り(表の見出し、マウスを載せた行、コードの地) | `#e9ecf0` | `#20252c` |
| `surface-strong` | 控えめな塗りの上で押したとき・重ねたとき | `#dce0e5` | `#2b3138` |
| `fg` | 本文の文字。フォーカスの輪 | `#181f27` | `#eaedf1` |
| `fg-muted` | 補足の文字(時刻、件数、入力の説明、字幕の原文) | `#555b64` | `#9fa5ad` |
| `border` | 区切り線、面と表の枠 | `#d6d9de` | `#2d333b` |
| `border-strong` | 入力欄と、押せる部品の枠 | `#7b8189` | `#696f78` |
| `primary` | 主なボタンの塗り、選んでいる印、PTT を押して準備している間の灯り | `#f8ac3d` | `#f7ad44` |
| `primary-hover` | 主なボタンにマウスを載せたとき | `#eb992e` | `#fcc364` |
| `on-primary` | primary の塗りの上の文字 | `#25170c` | `#201308` |
| `primary-soft` | 基調色の淡い塗り(札、知らせ、選んでいるナビ) | `#fceed6` | `#3f2909` |
| `primary-fg` | 基調色の文字(primary-soft の上の文字) | `#854a0b` | `#f4c26a` |
| `key` | 押して使う大きなキーの面(PTT を押していないとき) | `#21272f` | `#373e47` |
| `on-key` | key の面の上の文字 | `#f3f5f8` | `#f3f5f8` |
| `key-hover` | key の面にマウスを載せたとき | `#2f3640` | `#434b55` |
| `danger` | 削除など取り返しのつかない操作の塗り、入力の誤りの枠 | `#c52c2a` | `#ef6661` |
| `on-danger` | danger の塗りの上の文字 | `#ffffff` | `#200a08` |
| `danger-soft` | 誤り・失敗の淡い塗り | `#ffe8e6` | `#451e1c` |
| `danger-fg` | 誤り・失敗の文字 | `#a92321` | `#fb9890` |
| `warning-soft` | 注意の淡い塗り(音が止められている、モック API など) | `#ffe8d9` | `#3f2313` |
| `warning-fg` | 注意の文字 | `#8c431f` | `#fab688` |
| `success-soft` | 成功の淡い塗り | `#daf7e3` | `#143320` |
| `success-fg` | 成功の文字(保存しました) | `#036639` | `#7ad59c` |
| `live` | 送話(TX)。自分が PTT で声を送っている間の塗りと灯り | `#d42931` | `#d42f34` |
| `on-live` | live の塗りの上の文字 | `#ffffff` | `#ffffff` |
| `rx` | 受信(RX)の灯り。ほかの人が話している間 | `#2aa654` | `#51c672` |
| `rx-soft` | 受信中の字幕の帯の塗り | `#def8e2` | `#152d1a` |
| `rx-fg` | 受信の文字(受信中の帯の見出し) | `#1c5f31` | `#89da9b` |
| `overlay` | 画像・動画に重ねる帯(動画の長さ)、ダイアログの後ろに敷く幕 | `#13161ba6` | `#020306b3` |
| `on-overlay` | overlay の上の文字 | `#ffffff` | `#ffffff` |

## 角丸

| クラス | 大きさ |
| --- | --- |
| `rounded-sm` | 3px |
| `rounded-md` | 6px |
| `rounded-lg` | 10px |
| `rounded-xl` | 16px |

`rounded-full` も使える。余白と文字の大きさは Tailwind の既定(`p-4`、`text-sm` など)を使う。
