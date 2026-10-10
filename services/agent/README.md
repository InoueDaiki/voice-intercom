# services/agent

LiveKit Agent。話者の音声を OpenAI に中継し、字幕と翻訳音声をルームに配信する。構成は設計メモの「構成の案」の B。

- 原文の字幕: 話者ごとに1本の gpt-realtime-whisper
- 翻訳音声: 翻訳先の言語ごとに gpt-realtime-translate のセッションを作り、言語別のトラックで配信する
- 翻訳の字幕: whisper の書き起こしが確定したら、gpt-6-luna でテキスト翻訳する(STS の翻訳テキストはログに残すだけ)。長い発話は途中で区切り、区切りごとに確定と翻訳を進める

PoC(`poc/`)は LiveKit を使わずに OpenAI だけを測るスクリプトで、この Agent とは別に動く。

## ルームとの取り決め

| 項目 | 内容 |
| --- | --- |
| ディスパッチ | 明示(`agent_name`)。既定は `voice-intercom`(環境変数 `AGENT_NAME` で変える) |
| 参加者の言語 | 参加者の属性 `language`(BCP 47。`ja-JP` なら `ja` として扱う)。対応は gpt-realtime-translate の出力13言語。属性が無いか対応外の参加者は、翻訳先に数えない |
| 話者のトラック | マイクのトラックを常に publish し、話す間だけミュートを外す。ミュートが外れたら発話の開始、ミュート・unpublish・退室で発話の終わり |
| 翻訳音声のトラック | 言語ごとに1本、名前は `translation-<言語>`(例: `translation-en`)。同時に話している話者の翻訳音声は混ぜる。聞き手は自分の言語のトラックだけを選んで購読する |
| 字幕 | `proto/voiceintercom/v1/caption.proto` の `Caption` を、データチャネル(topic `caption`、reliable)で送る。断片を連結し、確定で全文に置き換える。字幕の区切りごとに `segment_id` を振り、同じ発話の区切りは `utterance_id` と `segment_index`(0 から)で表す |

翻訳先の言語は、発話を始めた時点のルームの参加者(Agent を除く)の言語から、話者と同じ言語を除いて決める。発話の途中で入った参加者の言語は、次の発話から対象になる。

## 発話の扱い

PoC で分かったことに従う(`realtime.py` の先頭にまとめてある)。

- セッションは発話ごとに作り直す。使い回すと、前の発話の切れ端が次の発話の頭に混ざる。
- ミュートの間は OpenAI に音声を送らない(無音も課金される)。
- 発話が終わったら、すぐ translate に `session.close` を送り、`session.closed` まで受信を続ける(上限は `TRANSLATE_CLOSE_TIMEOUT_S`、既定40秒)。whisper には `input_audio_buffer.commit` を送る。
- `session.update` を送ったら `session.updated` を待ってから音声を送る。待つ間の音声はためておく。
- ノイズ低減は無効。入力は 24kHz、翻訳音声の出力は 48kHz。

## 字幕の区切り

訳の字幕は whisper の書き起こしが確定してから作るので、PTT を離すまで確定しないと、長い発話では訳の字幕がずっと出ない。そこで発話の途中に区切りを作り、区切りごとに whisper の確定、テキスト翻訳、訳の字幕の配信を進める(`segmenter.py`)。翻訳音声(translate)は区切らない。

- gpt-realtime-whisper はサーバー側の自動区切り(`turn_detection`)に対応していない(null にする決まり。設計メモの「B で決めること」)。Agent が区切りを決めて、発話の途中でも whisper に `input_audio_buffer.commit` を送る。続きの音声は同じセッションの次の区切りになる。
- 区切る位置は、音量で見つけた無音(息継ぎ)と、書き起こしの文末(「。」「?」「.」など)の組み合わせで決める。必ず無音のところで区切り、音声の途中では切らない。
  - 区切りの長さが `SEGMENT_MIN_S`(既定4秒)に届くまでは区切らない。細かすぎると訳の質が下がる。PTT の短い発話は区切らない
  - 書き起こしが文末で終わっていて、無音が `SEGMENT_PAUSE_S`(既定0.4秒)続いたら区切る
  - 文末でなくても、無音が `SEGMENT_LONG_PAUSE_S`(既定1秒)続いたら区切る。書き起こしは音声より1秒ほど遅れるので、息継ぎの時点で文末がまだ届いていないことがある
  - 区切りが `SEGMENT_MAX_S`(既定15秒)より長くなったら、文末でなくても `SEGMENT_PAUSE_S` の無音で区切る
- 字幕は区切りごとに別の `segment_id` にする。同じ `segment_id` で確定を何回も出すと、「確定は最後に1回だけ」という取り決めが崩れ、古いアプリでは字幕が壊れる。別の `segment_id` なら、古いアプリは区切りを別々の字幕として表示する。新しいアプリは、`utterance_id` が同じ字幕を `segment_index` の順に並べて、1つの発話として見せられる。
- whisper の書き起こしのイベントは、commit ごとに作られる会話のアイテムの `item_id` で区切りに対応させる(アイテムは commit の順に作られる)。

## 今はやっていないこと

API・DynamoDB への保存、テキスト入力の読み上げ、録音、待機用のセッションを先に開いておく最適化、字幕の翻訳に前の区切りの文脈を渡すこと。

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
| `SEGMENT_ENABLED` | `1` | `0` にすると字幕を区切らない(PTT を離すまで確定しない) |
| `SEGMENT_MIN_S` | `4` | 区切りの最短の長さ(秒) |
| `SEGMENT_PAUSE_S` | `0.4` | 文末の後に、区切るのに要る無音(秒) |
| `SEGMENT_LONG_PAUSE_S` | `1` | 文末でなくても区切る無音(秒) |
| `SEGMENT_MAX_S` | `15` | これより長い区切りは、文末でなくても `SEGMENT_PAUSE_S` の無音で区切る(秒) |
| `SEGMENT_SILENCE_DBFS` | `-50` | これより小さい音量(10ms ごとの RMS)を無音とみなす |
| `ECS_AGENT_URI` | | ECS が入れる。あれば、ジョブを持つ間だけタスクのスケールイン保護を付ける(`task_protection.py`。無ければ何もしない) |
| `TASK_PROTECTION_EXPIRES_MIN` | `60` | 1回で付ける保護の長さ(分、1〜2880)。Agent が落ちたら、この長さで保護が切れる |
| `TASK_PROTECTION_RENEW_MIN` | `20` | ジョブがある間、保護を延長する間隔(分)。期限より短くする |
| `TASK_PROTECTION_MAX_HOURS` | `12` | 保護を続ける長さの上限(時間)。過ぎたら延長をやめる(ジョブが絶えないタスクでもデプロイが終わるように)。`0` なら上限なし |

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

### 字幕の区切りを確かめる

30秒ほどの長い発話で、区切りの位置と、訳の字幕が出るまでの時間を確かめる(OpenAI の API を使うので課金される。1回で whisper と translate を約30秒ずつ)。

1. ホストで音声を作る。`poc/make_audio.sh` が `long-ja-01.wav` と `long-en-01.wav` も作る。文末の短い間(0.4秒)、文の途中の息継ぎ(0.5秒)、長い間(1.2秒)が混ざっている。自分の声でも、同じくらいの長さを1回の発話として録音して試す。

   ```sh
   sh services/agent/poc/make_audio.sh
   ```

2. 上の 1〜3 のとおり、LiveKit サーバー、Agent、聞き手(`--verbose` を付ける)を起動する。
3. 長い音声を1回の発話として流す。比べるときは、Agent を `SEGMENT_ENABLED=0` で起動し直して同じ音声を流す。値を変えるときは `SEGMENT_MIN_S=6` のように環境変数で渡す。

   ```sh
   uv run services/agent/devtools/publish_wav.py --room test --language ja --identity speaker-ja \
     services/agent/poc/audio/long-ja-01.wav
   ```

見るべき点:

- 区切りの位置: Agent のログの「字幕を区切った」と、聞き手の画面の `確定: … [<utterance_id> #<番号>]`。文末で区切れているか、文の途中(「9時に届くはずだった、」の後の息継ぎ)で切れていないか。1.2秒の間で区切れるか。
- 書き起こしの文末: whisper の断片(`--verbose`)に、確定より前に「。」「.」が出るか。出るのが遅く、ほとんどが長い無音で区切られるなら、`SEGMENT_LONG_PAUSE_S` を見直す。
- whisper の振る舞い: 発話の途中の commit の後も、同じセッションで続きの書き起こしが届くか。断片と確定の `item_id` が区切りと対応しているか(区切りの確定が入れ替わったり、空になったりしないか)。
- 速さ: 区切りの終わりから、その区切りの訳の確定が出るまでの時間。区切らない場合(PTT を離してから約2秒で訳がそろう)と比べて、最初の訳がどれだけ早く出るか。
- 訳の質: 区切った訳をつなげたものと、区切らない場合の訳を比べる。主語や目的語が前の区切りにあって、訳が不自然になっていないか。
- 無音の閾値: 人の声や雑音のある場所で、`SEGMENT_SILENCE_DBFS` が合っているか(雑音で息継ぎが見つからない、小さい声を無音とみなす、など)。
- 翻訳音声: 区切っても、翻訳音声が途切れず最後まで届くか(保存した WAV)。

## テスト

OpenAI と LiveKit に依存しない部分(言語の決め方、発話の開始と終了の判断、字幕の区切りの判断、字幕の組み立て、翻訳音声の混ぜ方)を単体テストにしている。whisper の区切りと書き起こしのイベントの対応も、通信せずにテストしている。

```sh
uv run pytest services/agent
```

## デプロイ

ECS Fargate(ARM64)で動かす。イメージは `Dockerfile`(ビルドのコンテキストはリポジトリのルート)、インフラは `infra/modules/agent`。手順はルートの README の「LiveKit Agent(ECS Fargate)」を参照する。
