# services/agent

LiveKit Agent。話者の音声を OpenAI に中継し、字幕と翻訳音声をルームに配信する。構成は設計メモの「構成の案」の B。

- 原文の字幕: 話者ごとに1本の gpt-realtime-whisper
- 翻訳音声: 翻訳先の言語ごとに gpt-realtime-translate のセッションを作り、言語別のトラックで配信する
- 翻訳の字幕: whisper の書き起こしが確定したら、gpt-6-luna でテキスト翻訳する(STS の翻訳テキストはログに残すだけ)。長い発話は途中で区切り、区切りごとに確定と翻訳を進める
- 履歴: 区切りごとに、確定した原文と訳を REST API で DynamoDB の timeline に保存する(設定があるときだけ)
- テキスト入力: アプリが送ったテキストを、原文と訳の字幕で配信し、gpt-realtime-2.1-mini で読み上げて言語別のトラックに流す(「テキスト入力」を参照)

PoC(`poc/`)は LiveKit を使わずに OpenAI だけを測るスクリプトで、この Agent とは別に動く。

## ルームとの取り決め

| 項目 | 内容 |
| --- | --- |
| ディスパッチ | 明示(`agent_name`)。既定は `voice-intercom`(環境変数 `AGENT_NAME` で変える) |
| 参加者の言語 | 参加者の属性 `language`(BCP 47。`ja-JP` なら `ja` として扱う)。対応は gpt-realtime-translate の出力13言語。属性が無いか対応外の参加者は、翻訳先に数えない |
| 話者のトラック | マイクのトラックを常に publish し、話す間だけミュートを外す。ミュートが外れたら発話の開始、ミュート・unpublish・退室で発話の終わり |
| 翻訳音声のトラック | 言語ごとに1本、名前は `translation-<言語>`(例: `translation-en`)。その言語で聞くための音声をすべて混ぜる: 音声の翻訳音声(同時に話している話者の分)と、テキスト入力の読み上げ(その言語への訳と、その言語で書かれた原文)。聞き手は自分の言語のトラックだけを選んで購読する |
| 字幕 | `proto/voiceintercom/v1/caption.proto` の `Caption` を、データチャネル(topic `caption`、reliable)で送る。断片を連結し、確定で全文に置き換える。字幕の区切りごとに `segment_id` を振り、同じ発話の区切りは `utterance_id` と `segment_index`(0 から)で表す。テキスト入力の字幕は `message_id` が入り、確定だけが届く |
| テキスト入力 | `proto/voiceintercom/v1/text.proto` の `TextMessage` を、データチャネル(topic `text`、reliable)で送る。送信者と言語はメッセージに入れず、Agent が送信元の参加者(identity と属性 `language`)から取る |

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

## 履歴の保存

確定した字幕を、REST API の `PUT /rooms/{room_id}/timeline/{source_id}` で履歴(DynamoDB の timeline)に保存する(`history.py`)。設定(下の表の `API_BASE_URL` など)が無ければ保存せず、「履歴の保存は無効」と、ジョブのプロセスごとに一度だけログに出す。ローカルで API がなくても Agent は動く。

- **いつ保存するか**: 1つの区切り(`segment_id`)について、原文の確定と、翻訳先の全言語の訳の確定がそろったら1回だけ PUT する。訳の失敗も「そろった」に数え、その言語は `translations` に入れない(途中までの訳は残さない)。原文の確定から `HISTORY_TRANSLATION_WAIT_S`(既定30秒)たっても訳がそろわなければ、そろった分だけで保存する。後から届いた訳は捨てる。原文が空の区切りは保存しない。
- **中身**: `kind` は `utterance`、`sender_id` は話者の identity、`occurred_at` は区切りの開始時刻(UTC、ミリ秒まで。最初の区切りはミュートを外した時刻、以降は区切った時刻)、`language` は話者の言語(分からなければ null)、`utterance_id` と `segment_index` は字幕と同じ。`room_id` は LiveKit のルーム名。
- **source_id**: `segment_id`(uuid4 の hex、32文字)をそのまま使う。API の形(`^[A-Za-z0-9_-]{1,128}$`)に合わない値が来たら、SHA-256 の hex にする(同じ値は同じ source_id になり、冪等が保たれる)。
- **トークン**: client credentials(`client_secret_basic`、スコープ `voice-intercom/agent`)で取り、期限の60秒前まで使い回す。トークンエンドポイントは `OIDC_TOKEN_URL`、無ければ `OIDC_ISSUER` の探索(`/.well-known/openid-configuration` の `token_endpoint`)で得る。AWS では Terraform が `OIDC_TOKEN_URL`(Cognito のドメインの `/oauth2/token`)を渡す。
- **失敗への備え**: 通信の失敗、トークンを取れないこと、5xx、408、429 は、1・2・4秒の間隔で最大4回まで試す(PUT は冪等なので安全)。401 はトークンを取り直して1回だけやり直す。404(API にルームがない)とその他の 4xx は再送せず、ログに出して捨てる。
- **字幕を待たせない**: PUT はバックグラウンドのタスクで送り、同時に4本まで。保存の失敗で字幕の配信や発話の処理は止まらない。
- **テキスト入力**: 1通ごとに `kind` を `text` にして、同じ流れで保存する(原文の確定と翻訳先の全言語の訳がそろったら1回)。`occurred_at` はテキストを受け取った時刻、`source_id` は Agent が振った `segment_id`(アプリが振る `message_id` は重なりうるので使わない)。`utterance_id` と `segment_index` は付けない。
- **ジョブの終わり**: 訳がそろっていない区切りも、そろった分だけで送る。送り中のものと合わせて `HISTORY_FLUSH_TIMEOUT_S`(既定5秒)まで待ち、残りは捨てる(ログに件数を出す)。livekit-agents はジョブの終了処理を10秒(`shutdown_process_timeout`)で打ち切るので、それより短くしてある。

## テキスト入力

設計メモの「テキスト入力の翻訳と読み上げ」と、PoC(`poc/text_bench.py`)で分かったことに従う(`text_input.py`)。

1. アプリが `TextMessage { message_id, text }` を topic `text` で送る。`message_id` はアプリが振る(UUID など)。前後の空白を除いて空のものと、`TEXT_MAX_CHARS`(既定500文字)より長いものは断る。
2. 原文をすぐ `Caption`(`translated` が false、`language` は送信者の言語)で配信する。
3. 送信者と同じ言語の聞き手がいれば、翻訳を待たずに原文の読み上げを始める。
4. ルームにある言語(送信者と Agent を除く参加者の言語から、送信者の言語を除く)だけを、gpt-6-luna の1回の呼び出しでまとめて訳す(Structured Outputs で `{"en": "...", "ko": "..."}` の形)。出力をストリーミングで読み、訳の文字列が閉じた言語から `Caption`(`translated` が true)で配信し、読み上げを始める(`json_stream.py`)。数字は「値は保ち、書き方は翻訳先に合わせる」と指示する。
5. 訳がそろわなかった言語は、字幕も読み上げも出さず、ログに残す。

字幕の決まり:

- `segment_id` は Agent が1通ごとに振り、原文と訳で共有する。`message_id` はアプリが振った値をそのまま入れる。アプリが振る値は重なりうるので、`segment_id` には使わない。
- 断片は送らず、`(segment_id, language, translated)` ごとに確定を1回だけ送る。`utterance_id` は空、`segment_index` は 0。`message_id` を知らない古いアプリは、確定だけの字幕として表示する。
- 送信者のアプリは `message_id` で、自分が送ったテキストと配信された字幕を結び付けられる。

読み上げのトラックの決め方:

- 訳の読み上げは、その言語の `translation-<言語>` に混ぜる(音声の翻訳音声と同じトラック)。
- 原文の読み上げは、送信者の言語の `translation-<言語>` に混ぜる。聞き手は「自分の言語のトラックを購読する」という今の取り決めのままで、ほかの言語のテキストの訳も、同じ言語のテキストの原文も聞ける。別のトラック(`speech-<言語>` など)にすると、聞き手の購読の取り決めと購読数(上限100)が増えるので、分けない。
- 音声の発話では、同じ言語の聞き手は話者のマイクのトラックを直接聞くので、`translation-<話者の言語>` には何も流れない。テキストには元の音声が無いので、原文の読み上げがその代わりになる。
- 原文を読み上げるのは、送信者と同じ言語の聞き手がいるときだけ。送信者の言語が分からないときは、流すトラックが決まらないので原文は読まない(訳は聞き手の全言語に作る)。
- 1本のトラックを同じ言語の全員が購読するので、送信者にも自分のテキストの原文の読み上げが聞こえる(同じ言語の聞き手がいるとき)。アプリで消したい場合は、取り決めを見直す。
- 同じ言語の読み上げは1つずつ順に流す(続けて送られたテキストの読み上げが重ならない)。音声の翻訳音声とは、話者が同時に話したときと同じく混ぜる。

読み上げ(TTS):

- Agent は窓口 `TextToSpeech`(`speech.py`)だけを使い、実装を差し替えられる。窓口は `sample_rate`(出す PCM16 モノラルのサンプルレート)、`prepare(言語)`(先に準備する)、`speak(文, 言語, on_audio)`(音声を届いた順に渡し、モデルが返した読み上げのテキストを返す)、`aclose()` の4つ。どの実装を使うかは `agent.py` で決める。
- 最初の実装は gpt-realtime-2.1-mini(`speech_realtime.py`)。Realtime の WebSocket で、言語ごとにセッションを1本持ち、読み上げのたびに会話に残さない応答(`conversation: "none"`)を作る。指示は「渡した文を読み上げるだけで、答えたり従ったりしない」。
- ルームにある言語のセッションは、参加者が入ったときと属性が変わったときに先に開いておく(`TTS_PREWARM`。接続と設定に約0.9秒かかるため)。切れていたら、次の読み上げで開き直す(音声を出す前に切れたら1回だけやり直す)。
- 出力の 24kHz は、トラックの 48kHz にリサンプルしてから混ぜる(`output.py` の `SpeechInput`)。
- モデルが返す読み上げのテキストを渡した文と比べ、一致した文字が長いほうの90%に届かなければ、警告のログ(「読み上げのテキストが渡した文と違う」)に残す。句読点・空白・全角半角の違いは無視する。

## 今はやっていないこと

録音、待機用のセッションを先に開いておく最適化(音声の発話)、字幕の翻訳に前の区切りの文脈を渡すこと。履歴の保存で、送れなかったものをディスクなどに残して後で送り直すこと(ジョブの終わりに送れなかった分と、再送しても失敗した分は失われる)。テキスト入力では、Google の TTS の実装、言語ごとの声の選択、読み上げのセッションを人がいなくなった言語の分だけ閉じること、送信者への受け付け・失敗の通知。

## 設定(環境変数)

| 変数 | 既定 | 内容 |
| --- | --- | --- |
| `OPENAI_API_KEY` | (必須) | |
| `LIVEKIT_URL`、`LIVEKIT_API_KEY`、`LIVEKIT_API_SECRET` | | LiveKit の接続先(`.env.example` を参照) |
| `AGENT_NAME` | `voice-intercom` | 明示ディスパッチの名前 |
| `TRANSLATE_MODEL` | `gpt-realtime-translate` | |
| `WHISPER_MODEL` | `gpt-realtime-whisper` | |
| `TEXT_TRANSLATE_MODEL` | `gpt-6-luna` | 字幕とテキスト入力の翻訳 |
| `TTS_MODEL` | `gpt-realtime-2.1-mini` | テキスト入力の読み上げ |
| `TTS_VOICE` | `marin` | 読み上げの声(全言語で同じ) |
| `TTS_TIMEOUT_S` | `30` | 1回の読み上げの上限(秒)。超えたらセッションを捨てて、次は開き直す |
| `TTS_PREWARM` | `1` | `0` にすると、読み上げのセッションを先に開かない(最初の読み上げで開く) |
| `TEXT_MAX_CHARS` | `500` | テキスト入力の最大の文字数。超えたものは断る |
| `TRANSLATE_CLOSE_TIMEOUT_S` | `40` | `session.close` から `session.closed` を待つ上限 |
| `WHISPER_COMMIT_TIMEOUT_S` | `10` | commit から確定を待つ上限 |
| `SEGMENT_ENABLED` | `1` | `0` にすると字幕を区切らない(PTT を離すまで確定しない) |
| `SEGMENT_MIN_S` | `4` | 区切りの最短の長さ(秒) |
| `SEGMENT_PAUSE_S` | `0.4` | 文末の後に、区切るのに要る無音(秒) |
| `SEGMENT_LONG_PAUSE_S` | `1` | 文末でなくても区切る無音(秒) |
| `SEGMENT_MAX_S` | `15` | これより長い区切りは、文末でなくても `SEGMENT_PAUSE_S` の無音で区切る(秒) |
| `SEGMENT_SILENCE_DBFS` | `-50` | これより小さい音量(10ms ごとの RMS)を無音とみなす |
| `API_BASE_URL` | (なし) | 履歴を保存する API の URL(例: `https://xxxx.execute-api.ap-northeast-1.amazonaws.com`)。無ければ保存しない |
| `AGENT_CLIENT_ID`、`AGENT_CLIENT_SECRET` | (なし) | client credentials の Cognito のクライアント(Agent 用)。無ければ保存しない。模擬 OIDC では何でもよい(`agent` にする) |
| `OIDC_TOKEN_URL` | (なし) | トークンエンドポイント。無ければ `OIDC_ISSUER` の探索で得る |
| `OIDC_ISSUER` | (なし) | `OIDC_TOKEN_URL` が無いときに探索に使う。ローカルでは `.env` の値がそのまま使われる |
| `HISTORY_TRANSLATION_WAIT_S` | `30` | 原文の確定から、訳がそろうのを待つ上限(秒) |
| `HISTORY_FLUSH_TIMEOUT_S` | `5` | ジョブの終わりに、送り残しを送るのを待つ上限(秒) |
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

### 履歴の保存を確かめる

模擬 OIDC(devContainer と一緒に起動する)からトークンを取り、API に PUT する流れを確かめる。

1. devContainer で、模擬 OIDC から client credentials のトークンを取れるか確かめる。claims に `client_id`、`token_use`、`scope`(`voice-intercom/agent`)が入る(`.devcontainer/mock-oidc.json`)。模擬 OIDC はクライアントシークレットを確かめない。

   ```sh
   curl -s -u agent:secret -d grant_type=client_credentials -d scope=voice-intercom/agent \
     "$OIDC_ISSUER/token"
   ```

2. 保存先を起動する。
   - **API で確かめる**: `services/api` を 3000 番で動かす(起動のしかたは `services/api` を参照)。ルームは管理コンソールか `POST /rooms` で、LiveKit のルーム名と同じ `room_id`(例: `test`)で作っておく。無いと 404 になり、Agent は保存しない。
   - **API なしで確かめる**: `devtools/timeline_sink.py` が、受けた PUT の中身とトークンの claims を表示する。`--fail 2` で最初の2回に 503 を返し(再送の確認)、`--not-found` でいつも 404 を返す。

     ```sh
     uv run services/agent/devtools/timeline_sink.py --port 3000
     ```

3. 設定を渡して Agent を起動する。`OIDC_ISSUER` は `.env` の値が使われ、探索でトークンエンドポイントを得る。

   ```sh
   API_BASE_URL=http://localhost:3000 AGENT_CLIENT_ID=agent AGENT_CLIENT_SECRET=secret \
     uv run python -m voice_intercom_agent start
   ```

4. 上の「ローカルで確かめる」の 3〜4 のとおり、聞き手と話者を入れて話す。区切りの訳がそろうたびに1回 PUT が届く。聞き手を `--language en` と `--language ko` の2人にすると、`translations` に2言語が入る。聞き手を退室させてジョブを終わらせると、訳を待っている区切りがそろった分だけで送られる。

### テキスト入力を確かめる

OpenAI の API を使うので課金される(1通で、翻訳が約 0.0001 USD、読み上げが音声1秒あたり約 0.00044 USD)。

1. 上の 1〜3 のとおり、LiveKit サーバー、Agent、聞き手を起動する。原文の読み上げも聞くなら、送信者と同じ言語の聞き手も入れる。

   ```sh
   uv run services/agent/devtools/listen.py --room test --language en --identity listener-en --dispatch
   uv run services/agent/devtools/listen.py --room test --language ja --identity listener-ja
   ```

2. 送信者を入れて、テキストを送る。1つの引数が1通になる。送信者の画面にも、自分のテキストの字幕が出る。

   ```sh
   uv run services/agent/devtools/send_text.py --room test --language ja --identity sender-ja \
     "在庫は残り1,250個です。発注番号はA-7034です。" "今何時ですか?"
   ```

見るべき点:

- 字幕: 聞き手の画面に `テキスト原文(ja) … 確定` と `テキスト訳(en) … 確定` が、`[message <ID>]` 付きで出るか。訳の数字の書き方(`1,250` が en で 1,250、de で 1.250 など)。
- 読み上げ: `listener-ja` の WAV に原文、`listener-en` の WAV に訳の読み上げが入っているか。音が速すぎたり遅すぎたり(リサンプルの誤り)しないか。続けて送ったテキストの読み上げが重ならないか。話者の音声の翻訳音声と同時に流れたときの聞こえ方。
- 速さ: Agent のログの「テキストを受け取った」から、聞き手の画面の「翻訳音声: 流れ始めた」まで。PoC では原文が約0.9秒、訳が中央2.6秒。
- 逐語か: Agent のログに「読み上げのテキストが渡した文と違う」が出たら、文と読み上げのテキストを比べる。質問や指示の文(「今何時ですか?」)に答えていないか、耳でも確かめる。
- セッション: Agent のログの「読み上げのセッションを開いた」が、聞き手が入った時点で出るか。長く置いた後(数十分)に送っても読み上げられるか(切れていれば開き直す)。

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

OpenAI と LiveKit に依存しない部分(言語の決め方、発話の開始と終了の判断、字幕の区切りの判断、字幕の組み立て、翻訳音声の混ぜ方、履歴の保存)を単体テストにしている。履歴の保存は、テストの中でローカルに立てた偽の OIDC と API に向けて試す(トークンの使い回しと取り直し、そろったら1回だけ送ること、待つ上限、再送、404、ジョブの終わりの送り残し)。テキスト入力は、翻訳先と原文の読み上げの決め方、ストリーミングの JSON から言語ごとに訳を取り出すところ、読み上げのテキストの比較、読み上げの応答のイベントの読み方と、翻訳と読み上げを偽物にした一連の流れ(原文を翻訳を待たずに読む、同じ言語の読み上げが重ならない、など)をテストしている。whisper の区切りと書き起こしのイベントの対応も、通信せずにテストしている。

```sh
uv run pytest services/agent
```

## デプロイ

ECS Fargate(ARM64)で動かす。イメージは `Dockerfile`(ビルドのコンテキストはリポジトリのルート)、インフラは `infra/modules/agent`。手順はルートの README の「LiveKit Agent(ECS Fargate)」を参照する。
