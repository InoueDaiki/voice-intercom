# 端末の TTS の PoC(ブラウザの speechSynthesis)

設計メモの「端末の音声 API で費用を抑える案(2026-10-16。検討中)」のうち、ブラウザで翻訳後のテキストを読み上げる案を、耳で確かめるためのページ。本番のアプリ(`apps/web`)には入れない。確かめることと結果を書く表は、設計メモの「ブラウザの TTS の PoC」にある。

## 起動

devContainer の中で:

```sh
mise run poc:tts   # pnpm --dir tools/tts-poc dev と同じ。ポートは 5176
```

- Mac のブラウザ(Chrome・Safari)では `http://localhost:5176` を開く。
- スマートフォンでは、Mac と同じ LAN につなぎ、`http://${DEV_HOST}:5176`(`.env` の `DEV_HOST`。Mac の LAN の IP)を開く。`speechSynthesis` は HTTPS でなくても使える。
- 5176 番は `.devcontainer/compose.yaml` が LAN に公開する。この行を足す前に作ったコンテナでは、「Rebuild Container」をするまで LAN からは届かない。それまでは VS Code のポート転送で Mac の `localhost:5176` だけが届く。

devContainer には声が無いので、ページはホストやスマートフォンのブラウザで開く。

## 作り

| パス | 内容 |
| --- | --- |
| `src/core/pacing.ts` | 読み上げの待ち行列(`PacingQueue`)、待ちの量から速さを決める関数(`chooseRate`)、文字数からの長さの見積もり、声なしの模擬(`simulate`)。DOM を使わない |
| `src/core/languages.ts` | 13言語と、声の `lang` の突き合わせ(`en_US`、`in-ID` なども吸収する) |
| `src/core/text.ts` | cancel して渡し直すときの、残りの文の切り出し |
| `src/samples.ts` | 13言語の例文(短文、長めの文、長い発話を7つに区切ったもの)。訳文は PoC 用に用意したもの |
| `src/main.ts` | 画面と `speechSynthesis` |

`src/core` は Vitest で試す(`mise run test` に含まれる)。型の検査は `mise run lint` に含まれる。PoC なのでデザインシステム(`packages/ui-web`)は使わず、oxlint のデザインの規則の対象(`apps/**`、`packages/ui-web/**`)にも入れていない。

## ページでできること

1. **読み上げの許可**: 開いて2秒後に操作なしで `speak()` を呼び、鳴るか・`error`(`not-allowed` など)が来るかを記録する。解除のボタン(空の文、短い文)、タイマーからの `speak()`、タブに戻った直後の `speak()` も試せる。
2. **声の一覧**: 13言語ごとの声(名前、`lang`、`localService`、`default`、`voiceURI`)と、声が無い言語。
3. **例文の読み上げ**: 選んだ言語・声・速さで例文を読む。読み終えると、1.0倍に直した1秒あたりの文字数を声ごとに実測し、4の見積もりに使う。13言語の短文を順に読むボタンもある。
4. **待ち行列と速さの決め方**: 長い発話の区切りを、最初は「最初の遅れ」秒後、そのあと間隔ごとに届かせ、1区切りずつ TTS に渡す。前の区切りを読み終えた時点の待ちの量(1.0倍で読む秒数の見積もり)から次の速さを決める。区切りごとに、届いた・渡した・読み始め・読み終えの時刻、待ちの量、速さ、待ち、遅れを表に出す。「声なしで模擬」は同じ条件を見積もりだけで計算する。
5. **boundary イベント**: 選んだ言語のすべての声で短文を読み、`boundary`(word・sentence)が届くかを数える。
6. **cancel してから渡し直す**: 長めの文を読む途中で `cancel()` し、残りを別の速さで渡し直す。cancel した文に来るイベント、渡し直した文が鳴るかを記録する。
7. **ログと書き出し**: すべての結果とログ(時刻はページを開いてからのミリ秒)を JSON で書き出す(スマートフォンでは「コピー」も使える)。
