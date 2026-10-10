# services/agent

LiveKit Agent。話者の音声を OpenAI に中継し、字幕と翻訳音声をルームに配信する。構成は設計メモの「構成の案」の B。

- 原文の字幕: 話者ごとに1本の gpt-realtime-whisper
- 翻訳音声: 翻訳先の言語ごとに gpt-realtime-translate のセッションを作り、言語別のトラックで配信する
- 翻訳の字幕: whisper の書き起こしが確定したら、gpt-6-luna でテキスト翻訳する(STS の翻訳テキストはログに残すだけ)

PoC(`poc/`)は LiveKit を使わずに OpenAI だけを測るスクリプトで、この Agent とは別に動く。

## ルームとの取り決め

| 項目 | 内容 |
| --- | --- |
| ディスパッチ | 明示(`agent_name`)。既定は `voice-intercom`(環境変数 `AGENT_NAME` で変える) |
| 参加者の言語 | 参加者の属性 `language`(BCP 47。`ja-JP` なら `ja` として扱う)。対応は gpt-realtime-translate の出力13言語。属性が無いか対応外の参加者は、翻訳先に数えない |
| 話者のトラック | マイクのトラックを常に publish し、話す間だけミュートを外す。ミュートが外れたら発話の開始、ミュート・unpublish・退室で発話の終わり |
| 翻訳音声のトラック | 言語ごとに1本、名前は `translation-<言語>`(例: `translation-en`)。同時に話している話者の翻訳音声は混ぜる。聞き手は自分の言語のトラックだけを選んで購読する |
| 字幕 | `proto/voiceintercom/v1/caption.proto` の `Caption` を、データチャネル(topic `caption`、reliable)で送る。断片を連結し、確定で全文に置き換える |

翻訳先の言語は、発話を始めた時点のルームの参加者(Agent を除く)の言語から、話者と同じ言語を除いて決める。発話の途中で入った参加者の言語は、次の発話から対象になる。

## 発話の扱い

PoC で分かったことに従う(`realtime.py` の先頭にまとめてある)。

- セッションは発話ごとに作り直す。使い回すと、前の発話の切れ端が次の発話の頭に混ざる。
- ミュートの間は OpenAI に音声を送らない(無音も課金される)。
- 発話が終わったら、すぐ translate に `session.close` を送り、`session.closed` まで受信を続ける(上限は `TRANSLATE_CLOSE_TIMEOUT_S`、既定40秒)。whisper には `input_audio_buffer.commit` を送る。
- `session.update` を送ったら `session.updated` を待ってから音声を送る。待つ間の音声はためておく。
- ノイズ低減は無効。入力は 24kHz、翻訳音声の出力は 48kHz。

今はやっていないこと: 長い発話の字幕の区切り(PTT を離すまで訳の字幕が出ない)、API・DynamoDB への保存、テキスト入力の読み上げ、録音、待機用のセッションを先に開いておく最適化。

## 設定(環境変数)

| 変数 | 既定 | 内容 |
| --- | --- | --- |
| `OPENAI_API_KEY` | (必須) | |
| `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` | | LiveKit の接続先(`.env.example` を参照) |
| `AGENT_NAME` | `voice-intercom` | 明示ディスパッチの名前 |
| `TRANSLATE_MODEL` | `gpt-realtime-translate` | |
| `WHISPER_MODEL` | `gpt-realtime-whisper` | |
| `TEXT_TRANSLATE_MODEL` | `gpt-6-luna` | 字幕の翻訳 |
| `TRANSLATE_CLOSE_TIMEOUT_S` | `40` | `session.close` から `session.closed` を待つ上限 |
| `WHISPER_COMMIT_TIMEOUT_S` | `10` | commit から確定を待つ上限 |

## ローカルで確かめる

LiveKit サーバーはホスト、Agent と確認用ツール(`devtools/`)は devContainer で動かす。`.env` の `LIVEKIT_URL`(`ws://host.docker.internal:7880`)はコンテナの中から使う値なので、ホストの lk には `--url ws://localhost:7880` を渡す。

1. ホストで LiveKit サーバーを起動する。

   ```sh
   mise run livekit
   ```

2. devContainer で Agent を起動する。`registered worker` と出れば待ち受けている。

   ```sh
   uv run python -m voice_intercom_agent start
   ```

3. devContainer で聞き手を入れる。翻訳音声のトラック(`translation-en`)を購読して `devtools/out/` に WAV で保存し、字幕を表示する。`--dispatch` はトークンに Agent のディスパッチを入れる。トークンのディスパッチはルームを作るときにしか効かないので、ルームに最初に入る参加者で付ける。

   ```sh
   uv run services/agent/devtools/listen.py --room test --language en --identity listener-en --dispatch
   # 2つ目の言語を試すなら、別の端末で(--dispatch は付けない)
   uv run services/agent/devtools/listen.py --room test --language ko --identity listener-ko
   ```

   ルームが既にある場合は、ホストから lk で Agent を呼ぶ。

   ```sh
   lk dispatch create --url ws://localhost:7880 --dev --room test --agent-name voice-intercom
   ```

4. 話者を入れて、WAV を流す。方法は2つある。

   **Python(PTT と同じ流れ)**: devContainer で、トラックを publish してミュートしておき、WAV を流す間だけミュートを外す。1ファイルが1回の発話になる。

   ```sh
   uv run services/agent/devtools/publish_wav.py --room test --language ja --identity speaker-ja \
     services/agent/poc/audio/ja-01.wav services/agent/poc/audio/ja-03.wav
   ```

   **lk CLI**: lk が流せる音声は Ogg(Opus)だけなので、ホストで ffmpeg(`brew install ffmpeg`)を使って変換する。lk ではミュートを切り替えられないので、入室から退室(`--exit-after-publish`)までが1回の発話になる。

   ```sh
   ffmpeg -i services/agent/poc/audio/ja-01.wav -c:a libopus -ar 48000 -ac 1 ja-01.ogg
   lk room join --url ws://localhost:7880 --dev --identity speaker-ja --attribute language=ja \
     --publish ja-01.ogg --exit-after-publish test
   ```

5. 聞き手の画面に、原文の字幕(`原文(ja) … 確定`)、訳の字幕(`訳(en) … 確定`)、翻訳音声の始まりと終わりが出る。`--verbose` を付けると字幕の断片も出る。保存した WAV を聞いて、翻訳音声の末尾が欠けていないかを確かめる。Agent のログには、比較のために STS の翻訳テキストも出る。

`poc/audio/` の WAV の作り方は `poc/README.md` を参照する。

## テスト

OpenAI と LiveKit に依存しない部分(言語の決め方、発話の開始と終了の判断、字幕の組み立て、翻訳音声の混ぜ方)を単体テストにしている。

```sh
uv run pytest services/agent
```

## デプロイ

ECS Fargate(ARM64)で動かす。イメージは `Dockerfile`(ビルドのコンテキストはリポジトリのルート)、インフラは `infra/modules/agent`。手順はルートの README の「LiveKit Agent(ECS Fargate)」を参照する。
