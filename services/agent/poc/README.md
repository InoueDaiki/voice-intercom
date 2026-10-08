# 翻訳の遅延計測(PoC)

設計メモの「未確認事項と PoC 計画」のうち、次を LiveKit を使わずに測る。

- 初回遅延と語単位の遅延(日→英、英→日)
- 数字・固有名詞の訳
- PTT を離した直後の末尾の欠け(`session.close` の前に無音を送ると減るか)
- whisper を別セッションにする場合と、翻訳セッションの中で文字起こしする場合の比較

## 準備

1. `.env` に `OPENAI_API_KEY` を設定する。
2. 入力の WAV を用意する(16bit なら、サンプルレートとチャンネル数は問わない)。Mac での作り方:

   ```sh
   # 自分で録音した m4a(ボイスメモなど)を変換する
   afconvert -f WAVE -d LEI16@24000 -c 1 rec.m4a ja-01.wav

   # 読み上げ音声で作る(雑音がないので、遅延の基準に使う)
   say -v Kyoko -o ja-01.wav --data-format=LEI16@24000 "明日の午後3時に、品川の第2会議室で打ち合わせをします。"
   say -v Samantha -o en-01.wav --data-format=LEI16@24000 "The shipment of 250 units will arrive at Gate 14 on Thursday morning."
   ```

   WAV は `services/agent/poc/audio/` に置く(git 管理外)。下の「評価用の文」は、`services/agent/poc/make_audio.sh` でまとめて読み上げ音声にできる(`ja-01`〜`ja-05`、`en-01`〜`en-04`)。

## 実行

```sh
# 日本語 → 英語(原文は whisper で文字起こし)
uv run services/agent/poc/translate_bench.py services/agent/poc/audio/ja-01.wav --to en --source-lang ja

# 英語 → 日本語と韓国語を同時に(言語ごとに1セッション)
uv run services/agent/poc/translate_bench.py services/agent/poc/audio/en-01.wav --to ja,ko --source-lang en

# 末尾の欠けの確認。末尾に500msの無音を足してから session.close を送る
uv run services/agent/poc/translate_bench.py services/agent/poc/audio/ja-01.wav --to en --tail-silence-ms 500
```

主なオプション(すべては `--help` で見る):

| オプション | 内容 |
| --- | --- |
| `--to` | 翻訳先の言語。カンマ区切りで複数 |
| `--tail-silence-ms` | 末尾に足す無音。送り終えてから `session.close` を送る |
| `--noise-reduction` | `near_field`(既定)、`far_field`、`none` |
| `--inline-transcription` | 翻訳セッションでも原文の文字起こしを有効にする |
| `--no-whisper` | whisper のセッションを作らない |

## 結果の読み方

音声は100msずつ実時間のペースで送る。表の列は次のとおり。

| 列 | 意味 |
| --- | --- |
| 初回の字 | 入力の中で発話が始まった時刻から、最初の翻訳テキスト(whisper は原文)が届くまで |
| 初回の声 | 入力の中で発話が始まった時刻から、無音でない最初の翻訳音声が届くまで。翻訳音声は無音のチャンクも流れ続けるので、最初のチャンクではなく有声のものを数える |
| 最後の声 | 入力の発話が終わった時刻から、無音でない最後の翻訳音声が届くまで |
| 終了 | 入力の発話が終わった時刻から、`session.closed`(whisper は `completed`)が届くまで。末尾の無音を足した場合はその分も含む |
| 有声 | 無音でない翻訳音声の長さ(200ms 単位) |

`out/<日時>-<入力名>/` に次を保存する(git 管理外)。

- `summary.json`: 表の数値と全文
- `<セッション>.jsonl`: 受信したイベントと、送信開始からの時刻(ms)。語単位の遅延はここから読む
- `translate-<言語>.wav`: 翻訳音声。末尾が欠けていないか聞いて確かめる

## 確かめていないこと

- whisper の接続先は、公式ドキュメントに明記がない。`wss://api.openai.com/v1/realtime?intent=transcription` で動くことは確かめた(2026-10-08)。
- 翻訳音声のサンプルレートは公式に記載がなく、実測で 48kHz としている。
- 発話の開始は、振幅の閾値で推定している。雑音の多い録音ではずれる。

## 評価用の文

数字・固有名詞・専門用語を混ぜる。同じ文を、読み上げ音声と自分の声の両方で試す。

日本語:

1. 明日の午後3時に、品川の第2会議室で打ち合わせをします。
2. 在庫は残り1,250個です。発注番号はA-7034です。
3. 田中さん、3番ゲートのフォークリフトを北側の倉庫に回してください。
4. はい。(短い発話)
5. すみません、もう一度お願いします。

英語:

1. The shipment of 250 units will arrive at Gate 14 on Thursday morning.
2. Please send the invoice to Ms. Nakamura at Shibuya headquarters.
3. Copy that. (短い発話)
4. We need two more people on line B before 10:30.
