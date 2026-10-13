# services/agent

LiveKit Agent。話者の音声を OpenAI に中継し、字幕と翻訳音声をルームに配信する。構成は設計メモの「構成の案」の B。

- 原文の字幕: 話者ごとに1本の gpt-realtime-whisper
- 翻訳音声: 翻訳先の言語ごとに gpt-realtime-translate のセッションを作り、言語別のトラックで配信する
- 翻訳の字幕: whisper の書き起こしが確定したら、gpt-6-luna でテキスト翻訳する(STS の翻訳テキストはログに残すだけ)。長い発話は途中で区切り、区切りごとに確定と翻訳を進める
- 履歴: 区切りごとに、確定した原文と訳を REST API で DynamoDB の timeline に保存する(設定があるときだけ)
- 話し始めの通知: 話者がミュートを外したら REST API に知らせ、ルームにいないメンバーに push 通知を送ってもらう(設定があるときだけ。「話し始めの通知」を参照)
- 録音: 話者の元の音声を、発話ごとに Ogg/Opus にして S3 に保存する(設定があるときだけ。「録音」を参照)
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
- `TRANSLATE_TAIL_SILENCE_S` を 0 より大きくすると、`session.close` の前に、その秒数の無音を translate に待たずにまとめて送る(音声を1つも送っていない発話には送らない)。最後の文の翻訳が欠けるのを防ぐ案だが、96本の試行で欠けが再現せず効果を確かめられなかったので、既定は 0(送らない)。無音も課金され、0.5秒なら5秒の発話の translate の費用が約10%増える(設計メモの「Agent の見直し(2026-10-11)」)。
- `session.update` を送ったら `session.updated` を待ってから音声を送る。待つ間の音声はためておく。
- ノイズ低減は無効。入力は 24kHz、翻訳音声の出力も 24kHz(指定はできない)。翻訳音声はトラックの 48kHz にリサンプルしてから混ぜる(`output.py` の `AudioInput`)。

## 字幕の区切り

訳の字幕は whisper の書き起こしが確定してから作るので、PTT を離すまで確定しないと、長い発話では訳の字幕がずっと出ない。そこで発話の途中に区切りを作り、区切りごとに whisper の確定、テキスト翻訳、訳の字幕の配信を進める(`segmenter.py`)。翻訳音声(translate)は区切らない。

- gpt-realtime-whisper はサーバー側の自動区切り(`turn_detection`)に対応していない(null にする決まり。設計メモの「B で決めること」)。Agent が区切りを決めて、発話の途中でも whisper に `input_audio_buffer.commit` を送る。続きの音声は同じセッションの次の区切りになる。
- 区切る位置は、音量で見つけた無音(息継ぎ)と、書き起こしの文末(「。」「?」「.」など)の組み合わせで決める。必ず無音のところで区切り、音声の途中では切らない。
  - 区切りの長さが `SEGMENT_MIN_S`(既定4秒)に届くまでは区切らない。細かすぎると訳の質が下がる。PTT の短い発話は区切らない
  - 書き起こしが文末で終わっていて、無音が `SEGMENT_PAUSE_S`(既定0.4秒)続いたら区切る
  - 文末でなくても、無音が `SEGMENT_LONG_PAUSE_S`(既定1秒)続いたら区切る。書き起こしは音声より1秒ほど遅れるので、息継ぎの時点で文末がまだ届いていないことがある
  - 区切りが `SEGMENT_MAX_S`(既定15秒)より長くなったら、文末でなくても `SEGMENT_PAUSE_S` の無音で区切る
- 無音は、発話の中の音量からの相対値で決める(`SEGMENT_SILENCE_RATIO`、既定 0.25)。発話の始めからの 10ms ごとの音量のうち、上位 10% を声の大きさ、下位 5% を雑音の床とみなし、床から声までの 25% の位置より小さい音量を無音とみなす。小さい声(声が -50 dBFS より小さい)でも、雑音の多い場所(雑音が -50 dBFS より大きい)でも、息継ぎを見つけられる。発話の始めの1秒と、声と床の差が 6dB に満たないとき(雑音だけ)は、相対値を使わない(前者は固定の `SEGMENT_SILENCE_DBFS`、後者は何も無音とみなさない)。`SEGMENT_SILENCE_RATIO=0` で固定の閾値に戻る。
- 字幕は区切りごとに別の `segment_id` にする。同じ `segment_id` で確定を何回も出すと、「確定は最後に1回だけ」という取り決めが崩れ、古いアプリでは字幕が壊れる。別の `segment_id` なら、古いアプリは区切りを別々の字幕として表示する。新しいアプリは、`utterance_id` が同じ字幕を `segment_index` の順に並べて、1つの発話として見せられる。
- whisper の書き起こしのイベントは、commit ごとに作られる会話のアイテムの `item_id` で区切りに対応させる(アイテムは commit の順に作られる)。

## 履歴の保存

確定した字幕を、REST API の `PUT /rooms/{room_id}/timeline/{source_id}` で履歴(DynamoDB の timeline)に保存する(`history.py`)。設定(下の表の `API_BASE_URL` など)が無ければ保存せず、「履歴の保存と話し始めの通知は無効」と、ジョブのプロセスごとに一度だけログに出す。ローカルで API がなくても Agent は動く。

- **いつ保存するか**: 1つの区切り(`segment_id`)について、原文の確定と、翻訳先の全言語の訳の確定がそろったら1回だけ PUT する。訳の失敗も「そろった」に数え、その言語は `translations` に入れない(途中までの訳は残さない)。原文の確定から `HISTORY_TRANSLATION_WAIT_S`(既定30秒)たっても訳がそろわなければ、そろった分だけで保存する。後から届いた訳は捨てる。原文が空の区切りは保存しない。
- **中身**: `kind` は `utterance`、`sender_id` は話者の identity、`occurred_at` は区切りの開始時刻(UTC、ミリ秒まで。最初の区切りはミュートを外した時刻、以降は区切った時刻)、`language` は話者の言語(分からなければ null)、`utterance_id` と `segment_index` は字幕と同じ。`room_id` は LiveKit のルーム名。
- **source_id**: `segment_id`(uuid4 の hex、32文字)をそのまま使う。API の形(`^[A-Za-z0-9_-]{1,128}$`)に合わない値が来たら、SHA-256 の hex にする(同じ値は同じ source_id になり、冪等が保たれる)。
- **トークン**: client credentials(`client_secret_basic`、スコープ `voice-intercom/agent`)で取り、期限の60秒前まで使い回す。トークンエンドポイントは `OIDC_TOKEN_URL`、無ければ `OIDC_ISSUER` の探索(`/.well-known/openid-configuration` の `token_endpoint`)で得る。AWS では Terraform が `OIDC_TOKEN_URL`(Cognito のドメインの `/oauth2/token`)を渡す。
- **失敗への備え**: 通信の失敗、トークンを取れないこと、5xx、408、429 は、1・2・4秒の間隔で最大4回まで試す(PUT は冪等なので安全)。401 はトークンを取り直して1回だけやり直す。404(API にルームがない)とその他の 4xx は再送せず、ログに出して捨てる。
- **字幕を待たせない**: PUT はバックグラウンドのタスクで送り、同時に4本まで。保存の失敗で字幕の配信や発話の処理は止まらない。
- **テキスト入力**: 1通ごとに `kind` を `text` にして、同じ流れで保存する(原文の確定と翻訳先の全言語の訳がそろったら1回)。`occurred_at` はテキストを受け取った時刻、`source_id` は Agent が振った `segment_id`(アプリが振る `message_id` は重なりうるので使わない)。`utterance_id` と `segment_index` は付けない。
- **ジョブの終わり**: 訳がそろっていない区切りも、そろった分だけで送る。送り中のものと合わせて `HISTORY_FLUSH_TIMEOUT_S`(既定5秒)まで待ち、残りは捨てる(ログに件数を出す)。livekit-agents はジョブの終了処理を10秒(`shutdown_process_timeout`)で打ち切るので、それより短くしてある。

## 話し始めの通知

話者が話し始めた(ミュートを外した)ら、REST API の `POST /rooms/{room_id}/notifications/speaking` を呼び、ルームに入っていないメンバーに push 通知を送ってもらう(`notify.py`)。設定は履歴の保存と同じ(`API_BASE_URL` など)で、無ければ呼ばない。

- **中身**: `{"speaker_id": 話者の identity, "present_ids": [今ルームにいる人の identity, ...]}`。`present_ids` は、発話を始めた時点のルームの参加者のうち、kind が `STANDARD`(アプリから入った人)のもの。Agent、Egress、SIP などは除く。話者本人も入る(API 側で除く)。`room_id` は LiveKit のルーム名。応答は 200 で `{"sent": n, "skipped": m}`。
- **間引き**: API が「同じルーム × 同じ受け手には10分に1回まで」に絞るので、毎回呼んでも通知は増えない。API の呼び出しを減らすために、Agent でも同じルームについて `SPEAKING_NOTIFY_MIN_INTERVAL_S`(既定30秒)に1回までにする。間引いた発話の開始は、後から送り直さない。呼び出しが失敗しても、間隔は空ける。
- **トークン**: 履歴の保存と同じ client credentials のトークンを共有する(取り直しも共通)。HTTP のセッションも同じものを使う。
- **失敗への備え**: 通知は遅れて届いても意味が薄いので、通信の失敗(トークンを取れないことを含む)と 5xx だけ、0.5秒後に1回やり直す。401 はトークンを取り直して1回だけやり直す。404(API にルームがない)、408・429 を含むその他の 4xx は、やり直さずにログに出して捨てる。
- **発話を待たせない**: 呼び出しはバックグラウンドのタスクで行い、発話の処理と字幕を待たせない。
- **ジョブの終わり**: 送り中のものを1.5秒だけ待って打ち切る(履歴の送り残しと同時に待つ)。

## 録音

話者の元の音声(翻訳音声ではない)を、1回の発話ごとに1ファイルの Ogg/Opus にして S3 に保存する(`recording.py`)。`RECORDING_BUCKET` が無ければ録音せず、「録音は無効」とプロセスごとに一度だけログに出す。方式は設計メモの「録音の方式」の決定のとおりで、LiveKit の Egress(ルーム合成やトラック録音)は使わない。

- **単位**: 1回の発話(ミュート解除から、ミュート・unpublish・退室まで。字幕の `utterance_id` と同じ単位)。音声が1フレームも届かなかった発話は保存しない。
- **音声**: OpenAI に送るために受け取っているフレーム(24kHz・PCM16・モノラル)をそのまま使う。購読もリサンプルも増やさない。ミュートの間は送っていないので、録音にも入らない。
- **形式**: Ogg/Opus、モノラル、24kHz、`RECORDING_BITRATE`(既定 24kbps)、libopus の `application=voip`。1分で約 180〜280KB。
- **エンコード**: PyAV(FFmpeg の libopus)。PCM を約1秒ためてはスレッドに渡し(`asyncio.to_thread`)、発話の間に少しずつエンコードする。手元(arm64)の計測では、60秒の音声のエンコードに約0.2秒(1コアの 0.3% ほど)。出力は 8MB まではメモリ、超えたら一時ファイルに置く。
- **キー**: `rooms/<room_id>/<YYYY>/<MM>/<DD>/<utterance_id>-<speaker_id>.ogg`。日付は発話の開始時刻(履歴の `segment_index` が 0 の区切りの `occurred_at` と同じ時刻)の UTC。`room_id` は LiveKit のルーム名、`speaker_id` は話者の identity(履歴の `sender_id`)。英数字と `-_.~` 以外は `%XX` にする(`/` も)。`utterance_id` は32文字の hex なので、ファイル名の先頭32文字で取り出せる。
  - 履歴から録音を引くとき: `segment_index` が 0 の行があれば、`room_id`・`occurred_at` の日付・`utterance_id`・`sender_id` からキーが決まる。0 の行が無い(最初の区切りが空だった)ときは、その日の `rooms/<room_id>/<YYYY>/<MM>/<DD>/<utterance_id>-` で一覧する(日付をまたいだ発話は前の日も見る)。
- **メタデータ**(`x-amz-meta-*`): `room-id`、`utterance-id`、`speaker-id`、`language`(話者の言語。分からなければ空)、`started-at`(ISO 8601、UTC、ミリ秒まで)、`duration-s`(秒、小数3桁)。値は ASCII にする(キーと同じく `%XX`)。Content-Type は `audio/ogg`。タグは使わない(`s3:PutObjectTagging` が要るため)。
- **アップロード**: 発話が終わったらバックグラウンドで送る。boto3 の `upload_fileobj` をスレッドで呼び、8MB を超えるものはマルチパートになる。失敗したら1・2秒の間隔で最大3回まで試す(boto3 自身の再送とは別)。保存の失敗で字幕や翻訳は止まらない。
- **ジョブの終わり**: 終わっていない発話を閉じ、送り中のものを `RECORDING_FLUSH_TIMEOUT_S`(既定5秒)まで待って、残りは捨てる(ログに件数を出す)。履歴の送り残しと同時に待つので、livekit-agents の終了処理の10秒に収まる。
- **抜けを許す**: Agent が落ちている間、デプロイやスケールインでタスクが止められた後(`stopTimeout` の120秒を超えたルーム)、再ディスパッチまでの約15秒の音声は録れない。送れなかったものをディスクに残して後で送り直すこともしない。費用(Egress を使わない)を優先して、この抜けは許容する。
- **エンコーダーの選び方**: PyAV は livekit-agents が既に依存しているので、イメージは大きくならない。linux/arm64 の wheel(manylinux_2_28_aarch64)に libopus を含む FFmpeg が入っている。PyAV は BSD-3-Clause。wheel に同梱の FFmpeg には GPL のライブラリ(x264 など)も入っているが、イメージは自社の ECS で動かすだけで配布しない。opuslib はシステムの libopus と Ogg の多重化を自前で用意する必要があり、soundfile(libsndfile)は Opus の書き出しが同梱の版に依存するので採らなかった。S3 は boto3 にした(`services/api` と同じ版で、aioboto3 は aiobotocore が botocore の版を細かく縛る)。botocore が大きく、手元の比較ではイメージ(展開後)が約 50MB 増えた。

権限: ECS のタスクロールには、録音のバケットの `rooms/*` への `s3:PutObject` だけを付ける(`infra/modules/agent` の `recording`)。バケットは画像・動画(media)とは別の、非公開のもの(`infra/modules/recordings`)。

## テキスト入力

設計メモの「テキスト入力の翻訳と読み上げ」と、PoC(`poc/text_bench.py`)で分かったことに従う(`text_input.py`)。

1. アプリが `TextMessage { message_id, text }` を topic `text` で送る。`message_id` はアプリが振る(UUID など)。前後の空白を除いて空のものと、`TEXT_MAX_CHARS`(既定500文字)より長いものは断る。
2. 原文をすぐ `Caption`(`translated` が false、`language` は送信者の言語)で配信する。
3. 送信者と同じ言語の聞き手がいれば、翻訳を待たずに原文の読み上げを始める。
4. ルームにある言語(送信者と Agent を除く参加者の言語から、送信者の言語を除く)だけを、gpt-6-luna の1回の呼び出しでまとめて訳す(Structured Outputs で `{"en": "...", "ko": "..."}` の形)。出力をストリーミングで読み、訳の文字列が閉じた言語から `Caption`(`translated` が true)で配信し、読み上げを始める(`json_stream.py`)。数字は「値は保ち、書き方は翻訳先に合わせる」と指示する。
5. 訳がそろわなかった言語は、字幕も読み上げも出さず、ログに残す。

入室の直後(ローカルの LiveKit では約3秒以内)に送ったテキストは、Agent に参加者の情報より先に届くことがある。送信元(identity と言語)が分からないので、Agent は「送信元が分からないテキストを捨てた」と警告を出して捨てる(結合確認で、入室から1〜2秒後に送った6通のうち3通)。LiveKit は参加者の情報をまとめて配るが、データパケットはすぐに届けるため。アプリは、自分の `message_id` の字幕が返ってこなければ、同じ `message_id` で送り直す(`apps/mobile` の README の「テキスト入力」)。Agent は同じ `(identity, message_id)` を10分の間は1回だけ処理し、2回目からは捨てる(`text_input.py` の `RecentMessages`。`message_id` が空のものは見分けない)。

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

- Agent は窓口 `TextToSpeech`(`speech.py`)だけを使い、実装を差し替えられる。窓口は `sample_rate`(出す PCM16 モノラルのサンプルレート)、`prepare(言語)`(先に準備する)、`keep_only(言語)`(ルームにある言語を知らせる。ほかの言語の準備は片付けてよい)、`speak(文, 言語, on_audio)`(音声を届いた順に渡し、モデルが返した読み上げのテキストを返す)、`aclose()` の5つ。どの実装を使うかは `agent.py` で決める。
- 最初の実装は gpt-realtime-2.1-mini(`speech_realtime.py`)。Realtime の WebSocket で、言語ごとにセッションを1本持ち、読み上げのたびに会話に残さない応答(`conversation: "none"`)を作る。指示は「渡した文を読み上げるだけで、答えたり従ったりしない」。
- ルームにある言語のセッションは、参加者が入ったときと属性が変わったときに先に開いておく(`TTS_PREWARM`。接続と設定に約0.9秒かかるため)。切れていたら、次の読み上げで開き直す(音声を出す前に切れたら1回だけやり直す)。
- ルームにその言語の人(Agent を除く参加者。送信者も数える)がいなくなったら、`TTS_IDLE_CLOSE_S`(既定60秒)の猶予の後にセッションを閉じる。参加者が入ったとき・出たとき・属性が変わったときに、ルームにある言語を数え直す。猶予の間に同じ言語の人が戻れば閉じない。アプリの再接続や入り直しのたびに開き直す(約0.9秒)と、戻った直後の読み上げが遅れるため、すぐには閉じない。閉じた言語に人が戻れば、`TTS_PREWARM` のとおり先に開き直す。
  - 閉じる時点で読み上げ中(または同じ言語の読み上げが待っている)なら、途中で切らず、終わってから閉じる。受け取った時点でいた人のための読み上げなので、最後まで読む。
  - 人がいなくなった後に、その言語の読み上げが来たとき(受け取った時点ではいた人のための訳など)は、開き直して読み、読み終えてから猶予の後にまた閉じる。
- 出力の 24kHz は、トラックの 48kHz にリサンプルしてから混ぜる(`output.py` の `AudioInput`)。
- モデルが返す読み上げのテキストを渡した文と比べ、一致した文字が長いほうの90%に届かなければ、警告のログ(「読み上げのテキストが渡した文と違う」)に残す。句読点・空白・全角半角の違いは無視する。

## 今はやっていないこと

待機用のセッションを先に開いておく最適化(音声の発話)、字幕の翻訳に前の区切りの文脈を渡すこと。履歴の保存で、送れなかったものをディスクなどに残して後で送り直すこと(ジョブの終わりに送れなかった分と、再送しても失敗した分は失われる。録音も同じ)。ルーム全体を合成した録音(必要になったら Egress で足す)。テキスト入力では、Google の TTS の実装、言語ごとの声の選択、送信者への受け付け・失敗の通知。

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
| `TTS_IDLE_CLOSE_S` | `60` | ルームにその言語の人がいなくなってから、読み上げのセッションを閉じるまでの猶予(秒)。`0` ならすぐ閉じる(読み上げ中なら終わってから) |
| `TEXT_MAX_CHARS` | `500` | テキスト入力の最大の文字数。超えたものは断る |
| `TRANSLATE_CLOSE_TIMEOUT_S` | `40` | `session.close` から `session.closed` を待つ上限 |
| `TRANSLATE_TAIL_SILENCE_S` | `0` | `session.close` の前に translate に送る無音(秒)。`0` なら送らない |
| `WHISPER_COMMIT_TIMEOUT_S` | `10` | commit から確定を待つ上限 |
| `SEGMENT_ENABLED` | `1` | `0` にすると字幕を区切らない(PTT を離すまで確定しない) |
| `SEGMENT_MIN_S` | `4` | 区切りの最短の長さ(秒) |
| `SEGMENT_PAUSE_S` | `0.4` | 文末の後に、区切るのに要る無音(秒) |
| `SEGMENT_LONG_PAUSE_S` | `1` | 文末でなくても区切る無音(秒) |
| `SEGMENT_MAX_S` | `15` | これより長い区切りは、文末でなくても `SEGMENT_PAUSE_S` の無音で区切る(秒) |
| `SEGMENT_SILENCE_RATIO` | `0.25` | 無音の相対の閾値。雑音の床から声の大きさまでの、この割合の位置より小さい音量を無音とみなす。`0` なら固定の閾値(`SEGMENT_SILENCE_DBFS`) |
| `SEGMENT_SILENCE_DBFS` | `-50` | 固定の閾値。これより小さい音量(10ms ごとの RMS)を無音とみなす。相対の閾値では、発話の始めの1秒だけ使う |
| `API_BASE_URL` | (なし) | 履歴の保存と話し始めの通知で呼ぶ API の URL(例: `https://xxxx.execute-api.ap-northeast-1.amazonaws.com`)。無ければどちらもしない |
| `AGENT_CLIENT_ID`、`AGENT_CLIENT_SECRET` | (なし) | client credentials の Cognito のクライアント(Agent 用)。無ければ API を呼ばない。模擬 OIDC では何でもよい(`agent` にする) |
| `OIDC_TOKEN_URL` | (なし) | トークンエンドポイント。無ければ `OIDC_ISSUER` の探索で得る |
| `OIDC_ISSUER` | (なし) | `OIDC_TOKEN_URL` が無いときに探索に使う。ローカルでは `.env` の値がそのまま使われる |
| `HISTORY_TRANSLATION_WAIT_S` | `30` | 原文の確定から、訳がそろうのを待つ上限(秒) |
| `HISTORY_FLUSH_TIMEOUT_S` | `5` | ジョブの終わりに、送り残しを送るのを待つ上限(秒) |
| `SPEAKING_NOTIFY_MIN_INTERVAL_S` | `30` | 同じルームについて、話し始めの通知の API を呼ぶ最短の間隔(秒)。`0` なら発話の開始のたびに呼ぶ |
| `RECORDING_BUCKET` | (なし) | 録音を置く S3 のバケット。無ければ録音しない。接続先と認証情報は AWS SDK の標準の環境変数(ローカルは `AWS_ENDPOINT_URL_S3`)と ECS のタスクロール |
| `RECORDING_BITRATE` | `24000` | 録音の Opus のビットレート(bps) |
| `RECORDING_FLUSH_TIMEOUT_S` | `5` | ジョブの終わりに、送り中の録音を待つ上限(秒)。livekit-agents の終了処理の10秒より短くする |
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

   **devContainer の中で動かす場合**: 実機をつながず、Agent と確認用ツールだけで確かめるなら、LiveKit サーバーも devContainer で動かせる(`mise.toml` で入る。arm64 でも動く)。127.0.0.1 だけで待ち受けるので、Agent にも確認用ツールにも `--url ws://localhost:7880` を渡す(`.env` の `LIVEKIT_URL` はホストを指している)。環境変数で上書きするときは、`mise run` や `mise x` を通さない(mise が `.env` の値で上書きし直す)。同じ devContainer で別の Agent が `start` で動いていると、ヘルスチェックの HTTP のポート(8081)が重なり、後から起動したほうが `address already in use` で止まる。

   ```sh
   livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1
   uv run python -m voice_intercom_agent start --url ws://localhost:7880
   uv run services/agent/devtools/listen.py --url ws://localhost:7880 --room test --language en --dispatch
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

3. 設定を渡して Agent を起動する。`OIDC_ISSUER` は `.env` の値が使われ、探索でトークンエンドポイントを得る。コンテナから `.env` の `DEV_HOST` に届かない(ホストの LAN の IP が変わったなど)ときは、まず `.env` の `DEV_HOST` と `OIDC_ISSUER` を今の IP に直す。直せないときは、API と Agent の両方に同じ `OIDC_ISSUER`(今の IP か、コンテナの中だけで済ませるなら `http://oidc:8090/default`)を渡す(トークンの `iss` は接続した Host で決まるので、両方を揃える)。このときは `mise run api` ではなく `scripts/with-local-aws.sh uv run python -m voice_intercom_api.local_server` で起動する。`mise run` と `mise x` は、コマンドの前に付けた環境変数も `.env` の値で上書きし直す。

   ```sh
   API_BASE_URL=http://localhost:3000 AGENT_CLIENT_ID=agent AGENT_CLIENT_SECRET=secret \
     uv run python -m voice_intercom_agent start
   ```

4. 上の「ローカルで確かめる」の 3〜4 のとおり、聞き手と話者を入れて話す。区切りの訳がそろうたびに1回 PUT が届く。聞き手を `--language en` と `--language ko` の2人にすると、`translations` に2言語が入る。聞き手を退室させてジョブを終わらせると、訳を待っている区切りがそろった分だけで送られる。

### 話し始めの通知を確かめる

上の「履歴の保存を確かめる」と同じ準備で確かめられる。`devtools/timeline_sink.py` は `POST /rooms/{room_id}/notifications/speaking` も受け、中身とトークンの claims を表示する(通知は送らず、`{"sent": 0, "skipped": 0}` を返す)。`--fail` と `--not-found` は、こちらのパスにも効く。

1. `timeline_sink.py` か API を 3000 番で起動し、設定を渡して Agent を起動する(「履歴の保存を確かめる」の 2〜3)。間引きを確かめるときは、`SPEAKING_NOTIFY_MIN_INTERVAL_S=10` のように短くする。
2. 聞き手と話者を入れて、`publish_wav.py` で WAV を2つ以上流す。

見るべき点:

- 最初の発話の開始で `POST … notifications/speaking` が1回届き、`speaker_id` が話者、`present_ids` に聞き手と話者が入り、Agent は入っていないか。
- 30秒(`SPEAKING_NOTIFY_MIN_INTERVAL_S`)以内の続く発話では届かないか(Agent のログを DEBUG にすると「話し始めの通知を間引いた」が出る)。
- `--fail 1` で 503 を1回返すと、Agent が1回だけやり直すか。`--fail 2` では2回目でやめて、ログに「話し始めを通知できなかった」が出るか。
- API で確かめる場合は、ルームのメンバーで `present_ids` に入っていない人に通知が届き、応答の `sent` と `skipped` が Agent のログ(「話し始めを通知した」)に出るか。

### 録音を確かめる

ローカルの S3(SeaweedFS)に書く。先にルートの README の「ローカルの DynamoDB と S3」のとおり `mise run local:init` を済ませておく(録音のバケット `voice-intercom-local-recordings` も作る)。

1. Agent を `scripts/with-local-aws.sh` で包んで起動する。`RECORDING_BUCKET`、`AWS_ENDPOINT_URL_S3`、ローカル用の鍵が渡る。

   ```sh
   scripts/with-local-aws.sh uv run python -m voice_intercom_agent start
   ```

2. 上の「ローカルで確かめる」の 3〜4 のとおり、聞き手と話者を入れて話す。発話が終わるたびに Agent のログに「録音を保存した: rooms/test/…(… 秒)」が出る。
3. 録音を取り出して聞く。メタデータは `head-object` で見る。録音のバケットは匿名では読めない(media だけを許している)。

   ```sh
   scripts/with-local-aws.sh aws s3 ls --recursive s3://voice-intercom-local-recordings/rooms/test/
   scripts/with-local-aws.sh aws s3 cp s3://voice-intercom-local-recordings/<キー> services/agent/devtools/out/
   scripts/with-local-aws.sh aws s3api head-object --bucket voice-intercom-local-recordings --key <キー>
   ```

見るべき点: 発話の冒頭と末尾が欠けていないか(ミュートを外した直後の音、離す直前の音)、`duration-s` と話した長さが合うか、話者が同時に話したときにそれぞれのファイルに分かれるか。

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

   `say` は macOS 専用なので、devContainer では `devtools/concat_wav.py` で既にある WAV を無音を挟んでつなぐ(数字の引数が無音の秒数)。つないだ後の、-50 dBFS 未満の区間(固定の閾値の既定)を表示する。FLEURS の英語の録音は多くが -50 dBFS より小さく、日本語の録音には雑音が -35 dBFS ほどのものがある。無音の閾値を確かめるときは `--room-tone` を付け、挟む無音を、前の WAV の雑音の床と同じ音量のノイズにする(デジタルの無音は、どの閾値でも無音になる)。

   ```sh
   a=services/agent/poc/audio
   uv run services/agent/devtools/concat_wav.py -o $a/long-ja-cat.wav \
     $a/ja-01.wav 1.2 $a/ja-03.wav 1.0 $a/ja-02.wav 1.5 $a/fleurs/ja/1544.wav 1.2 $a/ja-05.wav
   # 小さい声の英語と、雑音の多い日本語(設計メモの「Agent の見直し」で使った音声)
   uv run services/agent/devtools/concat_wav.py --room-tone -o $a/long-en-quiet-cat.wav \
     $a/fleurs/en/1539.wav 1.2 $a/fleurs/en/1569.wav 1.0 $a/fleurs/en/1612.wav 1.5 $a/fleurs/en/1542.wav
   uv run services/agent/devtools/concat_wav.py --room-tone -o $a/long-ja-noisy-cat.wav \
     $a/fleurs/ja/1539.wav 1.2 $a/fleurs/ja/1567.wav 1.0 $a/fleurs/ja/1577.wav 1.5 $a/fleurs/ja/1636.wav
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
- 無音の閾値: 人の声や雑音のある場所で、息継ぎが見つかるか(雑音で見つからない、小さい声を無音とみなす、など)。比べるときは `SEGMENT_SILENCE_RATIO=0`(固定の閾値)で起動し直す。
- 翻訳音声: 区切っても、翻訳音声が途切れず最後まで届くか(保存した WAV)。

## テスト

OpenAI と LiveKit に依存しない部分(言語の決め方、発話の開始と終了の判断、字幕の区切りの判断、字幕の組み立て、翻訳音声の混ぜ方、履歴の保存)を単体テストにしている。履歴の保存は、テストの中でローカルに立てた偽の OIDC と API に向けて試す(トークンの使い回しと取り直し、そろったら1回だけ送ること、待つ上限、再送、404、ジョブの終わりの送り残し)。話し始めの通知は、間引きと `present_ids` の作り方を単体で、HTTP(1回だけのやり直し、401 の取り直し、4xx を捨てること、ジョブの終わりの打ち切り)を偽のサーバーで試す。テキスト入力は、翻訳先と原文の読み上げの決め方、ストリーミングの JSON から言語ごとに訳を取り出すところ、読み上げのテキストの比較、読み上げの応答のイベントの読み方と、翻訳と読み上げを偽物にした一連の流れ(原文を翻訳を待たずに読む、同じ言語の読み上げが重ならない、など)をテストしている。whisper の区切りと書き起こしのイベントの対応も、通信せずにテストしている。録音は、キーとメタデータの作り方、短い PCM を本物の PyAV でエンコードして Ogg/Opus として読めることと長さ、S3 を偽物にした保存の流れ(発話の終わりに1回だけ送る、音声の無い発話は送らない、再送、ジョブの終わりの待ち方)をテストしている。

```sh
uv run pytest services/agent
```

## デプロイ

ECS Fargate(ARM64)で動かす。イメージは `Dockerfile`(ビルドのコンテキストはリポジトリのルート)、インフラは `infra/modules/agent`。手順はルートの README の「LiveKit Agent(ECS Fargate)」を参照する。
