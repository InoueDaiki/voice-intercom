<!-- 生成物。packages/design-tokens/src/tokens.ts から `mise run gen:tokens` で作る。手で編集しない -->

# デザイントークン

色は役割の名前で選ぶ。Tailwind のクラスでは `bg-<名前>`、`text-<名前>`、`border-<名前>` のように書く(例: `bg-surface text-fg border-border`)。明暗は OS の設定で自動で切り替わるので、`dark:` は書かない。

## 色

| 名前 | 使う場面 | 明 | 暗 |
| --- | --- | --- | --- |
| `canvas` | ページの地(body) | `#f7fbfc` | `#091113` |
| `surface` | カード、表、入力欄、ヘッダーなど、地の上に置く面 | `#ffffff` | `#121b1d` |
| `surface-muted` | 控えめな塗り(表の見出し、選んでいるナビ、コードの地) | `#edf3f5` | `#1b2527` |
| `surface-strong` | 控えめな塗りの上で押したとき・重ねたとき | `#dfe8ea` | `#263134` |
| `fg` | 本文の文字 | `#162428` | `#e5edee` |
| `fg-muted` | 補足の文字(時刻、件数、入力の説明) | `#516165` | `#9ba7aa` |
| `border` | 区切り線、カードと表の枠 | `#d7e0e2` | `#2a3538` |
| `border-strong` | 入力欄と、押せる部品の枠 | `#828f92` | `#637275` |
| `primary` | 主なボタンの塗り、フォーカスの輪、選んでいる状態 | `#137875` | `#40c1bd` |
| `primary-hover` | 主なボタンにマウスを載せたとき | `#0f6563` | `#66d2ce` |
| `on-primary` | primary の塗りの上の文字 | `#ffffff` | `#011615` |
| `primary-soft` | 基調色の淡い塗り(バッジ、知らせ) | `#d9f5f4` | `#023634` |
| `primary-fg` | 基調色の文字(リンク、primary-soft の上の文字) | `#086260` | `#66d2ce` |
| `danger` | 削除など取り返しのつかない操作の塗り、入力の誤りの枠 | `#c52c2a` | `#ef6661` |
| `on-danger` | danger の塗りの上の文字 | `#ffffff` | `#200a08` |
| `danger-soft` | 誤り・失敗の淡い塗り | `#ffe8e6` | `#451e1c` |
| `danger-fg` | 誤り・失敗の文字 | `#a92321` | `#fb9890` |
| `warning-soft` | 注意の淡い塗り(音が止められている、モック API など) | `#feedc9` | `#3c2a0e` |
| `warning-fg` | 注意の文字 | `#804d0c` | `#edbf71` |
| `warning` | 注意の線(PTT を押したがまだ話せていない) | `#e8a127` | `#eba941` |
| `success-soft` | 成功の淡い塗り | `#daf7e3` | `#143320` |
| `success-fg` | 成功の文字(保存しました) | `#036639` | `#7ad59c` |
| `live` | 送話中(PTT で声を送っている)の塗りと線 | `#d7314b` | `#d3384e` |
| `on-live` | live の塗りの上の文字 | `#ffffff` | `#ffffff` |
| `kind-voice` | タイムラインの、音声の発話の印 | `#1f9996` | `#32a5a2` |
| `kind-text` | タイムラインの、テキスト入力の印 | `#3f9b65` | `#4ca871` |
| `kind-media` | タイムラインの、画像・動画・ファイルの印 | `#dc932e` | `#df9b44` |
| `overlay` | 画像・動画に重ねる帯(動画の長さ) | `#111719a6` | `#010405b3` |
| `on-overlay` | overlay の上の文字 | `#ffffff` | `#ffffff` |

## 角丸

| クラス | 大きさ |
| --- | --- |
| `rounded-sm` | 4px |
| `rounded-md` | 8px |
| `rounded-lg` | 12px |
| `rounded-xl` | 16px |

`rounded-full` も使える。余白と文字の大きさは Tailwind の既定(`p-4`、`text-sm` など)を使う。
