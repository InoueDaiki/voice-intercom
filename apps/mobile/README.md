# apps/mobile

Flutter のアプリ(iOS / Android)。ホストで開発する(devContainer には Flutter を入れない)。版は `mise.toml` で固定している。

今あるのは動く最小の骨組み。push 通知、iOS の PushToTalk フレームワークは、まだ入れていない。入室中は、バックグラウンドでも音声を保つ(下の「バックグラウンドでの音声」)。ルームで画像・動画を送れ、ルームの表示と履歴で見られる。ほかの人が送ったものも、入室中ならデータチャネル(topic `media`)の配信ですぐ出る(下の「画像・動画」)。

## 動かす

ローカルの環境(ルートの README)を先に起動しておく。

| もの | 起動のしかた |
| --- | --- |
| LiveKit サーバー | ホストで `mise run livekit`(下の「注意」を参照) |
| API | devContainer で `mise run api`(`http://<DEV_HOST>:3000`) |
| 模擬 OIDC | devContainer と一緒に起動する(`http://<DEV_HOST>:8090/default`) |
| Agent | devContainer で起動する(`services/agent/README.md` の「ローカルで確かめる」) |

ルームは管理コンソールか `POST /rooms` で作り、`member_ids` にログインに使うユーザー名(模擬 OIDC では入力したユーザー名が sub になる)を入れておく。

```sh
cd apps/mobile
flutter pub get
flutter run --dart-define=DEV_HOST=<.env の DEV_HOST>
```

- ログインでは模擬 OIDC の画面が出る。ユーザー名を入れ、claims に `{"token_use": "access", "client_id": "mobile"}` を入れる(API は `client_id` と `token_use` を確かめる)。
- 初回はプロフィール(表示名と言語)の登録を求められる。登録しないと LiveKit のトークンが 409 になる。

### 設定

`--dart-define` で渡す(`lib/config.dart`)。ローカルは `DEV_HOST` だけでよい。

| 変数 | 内容 | 既定 |
| --- | --- | --- |
| `DEV_HOST` | ホストの LAN の IP(実機からも届く) | なし |
| `OIDC_ISSUER` | トークンの iss。探索でエンドポイントを得る | `http://<DEV_HOST>:8090/default` |
| `OIDC_CLIENT_ID` | OIDC のクライアント ID | `mobile` |
| `OIDC_REDIRECT_URL` | リダイレクト先(Cognito の `mobile_callback_urls`) | `voiceintercom://callback` |
| `API_BASE_URL` | API の URL | `http://<DEV_HOST>:3000` |

AWS の dev 環境に向けるときは、`terraform output` の `oidc_issuer`、`cognito_client_ids.mobile`、`api_endpoint` を渡す。

### 注意

- iOS は Swift Package Manager と CocoaPods を併用している。`video_compress` が Swift Package Manager に対応していないため(`ios/Podfile`)。ホストに CocoaPods(`pod`)が要る。`flutter run` / `flutter build` が `pod install` を行う。
- LiveKit サーバーは macOS 向けのバイナリが配布されていないので、ホストの `mise run livekit` は公式のイメージ(`livekit/livekit-server`)を Docker で動かす(ルートの `mise.toml`)。Docker Desktop を起動しておく。
- ローカルは http / ws なので、Android は debug ビルドだけ平文の通信を許している(`android/app/src/debug/AndroidManifest.xml`)。OIDC も http のときだけ平文を許す(`lib/auth.dart`)。

## 構成

| パス | 内容 |
| --- | --- |
| `lib/auth.dart` | OIDC(認可コード + PKCE)。リフレッシュトークンを安全な保存先に置き、期限の前に取り直す |
| `lib/api.dart` | REST API。生成したクライアント(`packages/api-client/dart`)に、呼ぶたびにアクセストークンを付ける |
| `lib/app_state.dart` | ログインとプロフィールの段階。画面はこれで切り替える |
| `lib/room/room_session.dart` | LiveKit の接続、PTT、購読、字幕とテキストの受け渡し |
| `lib/room/subscription.dart` | 購読するトラックの決め方 |
| `lib/room/caption_board.dart` | 字幕の組み立て |
| `lib/room/text_sender.dart` | テキスト入力の送信と送り直し |
| `lib/room/media_feed.dart` | ルームの表示に出す画像・動画(`event_id` で重ねない)と、字幕との時刻の順の並べ方 |
| `lib/room/media_receiver.dart` | topic `media` の `MediaMessage` を受け、履歴で確かめてから表示に渡す |
| `lib/media/media_picker.dart` | 画像・動画を選ぶ・撮る(`image_picker`) |
| `lib/media/media_preparer.dart` | 送る形に整える(画像の形式、動画の圧縮、サムネイル) |
| `lib/media/media_type.dart` | ファイルの形式を先頭のバイトで見分ける |
| `lib/media/media_uploader.dart` | 整える → uploads → PUT → complete と、段階ごとのやり直し |
| `lib/media/http_put.dart`、`api_media_backend.dart` | 署名付き URL への PUT、API との受け渡し |
| `lib/screens/media_widgets.dart`、`media_viewer_screen.dart` | サムネイル、送信中の表示、画像の全画面と動画の再生 |
| `lib/room/background_audio.dart` | 入室中のバックグラウンドでの音声(Android はフォアグラウンドサービスを動かす) |
| `android/app/src/main/kotlin/.../InRoomService.kt` | Android の入室中のフォアグラウンドサービスと通知。`MainActivity.kt` の MethodChannel(`voiceintercom/in_room`)から始め、止める |
| `lib/screens/` | ログイン、プロフィール、ルームの一覧、ルーム、履歴 |

型は生成物を使う。REST は `packages/api-client/dart`、データチャネルのメッセージは `packages/schema/dart`(どちらも path で参照し、手で編集しない)。

## ルームでの振る舞い

`services/agent/README.md` の「ルームとの取り決め」に合わせている。

- **PTT**: 入室したらマイクのトラックを publish する。publish の前にミュートしておくので、ミュートのまま publish され、音は漏れない。押している間だけミュートを外す。ミュートの操作は1つずつ順に、必ず await する(設計メモの「PTT の方式」)。iOS では接続の前に `AudioManager.instance.setMicrophoneMuteMode(MicrophoneMuteMode.inputMixer)` にし(OS のミュート音が鳴らない)、トラックは `stopAudioCaptureOnMute: false` で作る(ミュートでマイクを止めず、外すのが速い)。Android では `setMicrophoneMuteMode` は何もしない。
- **聞く**: `autoSubscribe` を切り、Agent 以外の参加者のマイクのトラックと、Agent の `translation-<自分の言語>` だけを購読する。
- **字幕**: topic `caption` は、送信元が Agent の参加者(`DataReceivedEvent.participant` の `kind` が `AGENT`)のものだけを読み、送信元が無いもの・Agent 以外の参加者のものは捨てる。参加者は topic を偽れるため(トークンの `canPublishData` は topic を限れない。設計メモの「字幕の送信元」)。`Caption` を `(segment_id, language, translated)` ごとに連結し、確定で置き換える(空の確定は消す)。区切り(`segment_id`)ごとに、原文と自分の言語の訳を並べる。話者と同じ言語なら訳は出ない(Agent が作らない)。
- **テキスト入力**: topic `text` で `TextMessage` を送る。Agent をまだ知らない間は送らずに待ち、Agent が入ったらすぐ送る。Agent が後から入るルームでは、アプリが Agent を知るまでの約3秒に返ってきた字幕を捨ててしまい、送り直しは Agent が重複として捨てるため。入室の直後(約3秒以内)に送ると、Agent が送信元を知らずに捨てることがある(設計メモの「Agent の結合確認」)。Agent は受け付けるとすぐ原文の字幕を `message_id` 付きで配信するので、自分の `message_id` の字幕が4秒のうちに届かなければ、同じ `message_id` で送り直す(3回まで。だめなら「届かなかった」と出す)。Agent は同じ `(identity, message_id)` を1回だけ処理する。
- **履歴**: `GET /rooms/{room_id}/timeline` を50件ずつ、`next_before` で古いほうへ読む。画像・動画の行はサムネイルを出し、タップで開く。
- **画像・動画**: 下の「画像・動画」。

## 画像・動画

設計メモの「画像・動画の処理」と「画像・動画のルームへの配信」の「アプリの表示と再生」「端末での圧縮」に沿っている。

### 送る

テキスト入力の左のボタンから、写真ライブラリで選ぶ(画像か動画)、写真を撮る、動画を撮る。送るものは1つずつ順に処理する(`MediaUploader`)。

1. **整える**(`DeviceMediaPreparer`)。形式は拡張子や mimeType ではなく、ファイルの先頭のバイトで見分ける。
   - 画像: `image_picker` に `imageQuality: 85` と `maxWidth` / `maxHeight: 2048` を渡して選ぶ(iOS の HEIC も JPEG になる見込み)。届いた形式が JPEG、PNG、WebP、HEIC ならそのまま送る。GIF など API が受け付けない形式は JPEG にする(動きは失う)。1MB を超えたらサムネイル(JPEG、長い辺 480px)を作る。HEIC のまま届いたら、アプリでは読めない(`image` が HEIC を読めない)ので、サムネイルなしで `image/heic` として送る。
   - 動画: `video_compress` で H.264 の MP4(1280x720 まで、音声つき)にし、サムネイルを作る(動画は必ず作る)。長さは3分まで(案。カメラは `maxDuration` で、ライブラリから選んだものは圧縮の前に確かめる)。圧縮しても 100MB を超えれば送らない。
2. **uploads**(`POST .../media/uploads`)で署名付き URL をもらう。`size_bytes` は整えた後の大きさ。
3. **PUT**。本体を `content_type` と同じ Content-Type で、サムネイルを `image/jpeg` で PUT する。Content-Length を付け、charset などは付けない(署名が合わず 403 になる)。
4. **complete**(`POST .../media/{media_id}/complete`)。応答(履歴の行)で、すぐルームの表示に足す。

送信中は、送信者の画面にだけ段階(圧縮中・送信中・保存中)と進み具合を出す。ほかの人には何も送らない。

失敗したら「送れなかった」を出し、「やり直す」でその段階から続ける。

- 整えたファイルは作り直さない。署名付き URL は期限(1時間)の5分前までは使い回し、それより近ければ uploads から取り直す。
- PUT し終えたもの(本体、サムネイル)は上げ直さない。complete が 409(本体かサムネイルが無い)なら、PUT からやり直す。
- complete は2回目からも同じ履歴を返すので、応答が失われたときに呼び直しても重ならない。
- 形式・大きさ・長さで送れないものは、やり直しのボタンを出さない(× で一覧から外す)。

### 見る

ルームの表示では、字幕と画像・動画を時刻の順に並べる(字幕は届いた時刻、画像・動画は `occurred_at`)。送信者・時刻・サムネイル(無ければ画像は本体、動画は枠だけ)・添えた文を出し、タップで画像を全画面(つまんで拡大)に、動画を再生(`video_player` に URL をそのまま渡す)にする。一覧ではサムネイルだけを読み、本体はタップしてから読む。

画像・動画は、次の3つから入る(`MediaFeed`。`event_id` で重ねない)。

- 自分の送信: complete の応答。
- ルームへの配信: API が complete の後に、データチャネルの topic `media` で送る `MediaMessage`(下の「受ける」)。
- 抜けを埋める: 入室したときと、つなぎ直したとき(`RoomReconnectedEvent`)に、`GET /rooms/{room_id}/timeline` の最新の50件を読む。データチャネルは、つながっている間しか届かないため。

### 受ける(ルームへの配信)

`RoomSession._onData` で topic `media` を受け、`MediaReceiver`(`lib/room/media_receiver.dart`)に渡す。

1. **送信元の参加者がある(`DataReceivedEvent.participant` が null でない)ものは捨てる。** 参加者は topic を偽れるため(設計メモの「B の受け手の決まり」)。
2. 読めないもの、`event_id` が空のもの、もう表示している・確かめている途中の `event_id` は捨てる。自分の送信(complete の応答で出したもの)と、complete のやり直しで2回目に届いたものは、ここで消える。履歴も読まない。
3. **残りは「履歴に新しい行がある」という知らせとして扱う。** `GET /rooms/{room_id}/timeline` の先頭のページ(新しい順の50件)を読み、`event_id` の行があれば、その行(`MediaMessage` の中身ではなく)を `addMedia` に渡す。無ければ1秒後と3秒後に読み直し、それでも無ければ捨てる。
   - 履歴を読むのは同時に1回だけ。読んでいる間に届いたものは、読み終えてから次の1回でまとめて確かめる。確かめ待ちは50件まで。
   - 読み直すのは、履歴の読み込みが DynamoDB の結果整合の読み取り(`ConsistentRead` を付けていない)で、保存の直後は行がまだ見えないことがあるため。ローカルの DynamoDB Local では、すぐ見える。
   - 表示は履歴の行なので、`text_truncated` が true でも全文が出る。

**送信元の確かめに履歴を使う理由**(SDK の送信元の identity を使わない理由)。送信元の参加者が null というだけでは、API から来たとは言えない。受け手が新しい参加者を知るまでの約3秒は、参加者が送ったものも null で届く(設計メモの「サーバー側の確認」)。

- `livekit_client`(2.13.1)では、送信元の identity は内部のイベント(`EngineDataPacketReceivedEvent.identity`)にしか無い。このイベントは `@internal` で、パッケージの公開の API(`livekit_client.dart`)から export されていない。使うには `package:livekit_client/src/...` を直接 import して `room.engine` のイベントを聞くことになり、SDK の版を上げると黙って壊れうる(内部の名前や流れは予告なく変わる)。
- 履歴で確かめれば、送信元だけでなく中身(URL、送信者、添えた文)も API が保存したものになる。偽った `MediaMessage` は、本物の `event_id` を書いても、表示されるのは履歴の行なので害が無い。偽った `event_id` は履歴に無いので出ない。
- 費用は、1件につき受け手ごとに1回の GET(100人のルームなら100回)。ルームの表示で待つのは、配信から1回の API 呼び出しの分(ローカルで数ミリ秒〜数十ミリ秒)。

`MediaReceiver` を作るのは、履歴を読む関数を渡したとき(`RoomSession` の `fetchRecentTimeline`。ルームの画面が渡す)だけ。渡さなければ topic `media` を捨てる。

### 残していること


- 添えた文の入力。API の `text` は渡せる(`MediaUploader.submit` の `text`)が、画面には入力欄がない。
- 送信中の取り消し(圧縮・アップロードの途中で止める)。
- 端末でのキャッシュ。今は `Image.network` のメモリのキャッシュだけ。URL の中身は変わらないので、ディスクに長く持ってよい(設計メモの「URL」)。
- 幅・高さ・動画の長さ(表示の枠を先に取る。設計メモの「決めていないこと」)。
- 100MB 以上のマルチパート。

## バックグラウンドでの音声

入室している間は、アプリがバックグラウンドにいても(ホームに戻る、別のアプリに切り替える)、聞くことと送ること(マイクのトラック)を続ける(設計メモの「バックグラウンドでの音声」の方針案)。アプリを閉じている間は音声を受けない。

- **iOS**: `Info.plist` の `UIBackgroundModes` に `audio` を入れるだけ(livekit_client の README の作法)。オーディオセッションは livekit_client の `AudioManager` が自動で持ち、マイクを publish している間は playAndRecord で有効にしておく。アプリからはセッションを触らない。マイクはミュートでも止めない(`stopAudioCaptureOnMute: false`)ので、裏に回っても録音のエンジンは動いたままになる。
- **Android**: 入室中だけ、フォアグラウンドサービス(`InRoomService`)を動かし、「<ルーム名> に入室中」の通知を出す。サービスがないと、裏に回った直後に OS がマイクを止め(silenced)、しばらくするとプロセスが凍結されて、受信も止まる(エミュレーターで確かめた)。
  - 種類は `microphone` と `mediaPlayback`。マイクの権限がなければ `mediaPlayback` だけ(受信だけ)で始め、画面に知らせる。
  - Android 14 以降は、バックグラウンドからマイクのフォアグラウンドサービスを新しく始められない。そこで、入室の時点(フォアグラウンド。マイクを publish して権限を得た後)で始める。始められなくても入室は止めず、「バックグラウンドに回ると音声が止まることがある」と出す。
  - 止めるのは、退室(ルームの画面を閉じる)、切断(`RoomDisconnectedEvent`)、入室の失敗、アプリの終了(Flutter のエンジンが外れるとき。タスクを消したとき)。エンジンが外れると flutter_webrtc がマイクのストリームも破棄する。
  - 通知の権限(Android 13 以降)は、サービスを始めるときに求める。断られてもサービスは動く(通知が出ないだけ)。

## パッケージを選んだ理由

| パッケージ | 理由 |
| --- | --- |
| 状態管理・ルーティングのパッケージは使わない | 画面は5つで、状態はログインの段階とルームの接続の2つだけ。Flutter の `ChangeNotifier` と `ListenableBuilder`、`Navigator` で足りる。画面と状態が増えたら見直す |
| `livekit_client` | 公式の SDK(設計メモの「LiveKit の設計」)。`setMicrophoneMuteMode` が要るので 2.9.0 以降 |
| `flutter_appauth` | 標準の OIDC(探索、認可コード + PKCE、リフレッシュ)を AppAuth(iOS / Android の公式ライブラリ)で行う。Cognito 専用の SDK を使わないので、模擬 OIDC と同じコードで動く。iOS は Cookie を共有しないブラウザ(ephemeral)でログインする |
| `flutter_secure_storage` | リフレッシュトークンを Keychain / Keystore に置く |
| `protobuf` | `packages/schema/dart` の実行時ライブラリ |
| フォアグラウンドサービスのパッケージは使わない | 要るのは「入室で始め、退室・切断・終了で止め、通知を1つ出す」だけで、Kotlin で200行足らず(`InRoomService.kt` と `MainActivity.kt`)で足りる。音声は LiveKit が同じプロセスで扱うので、汎用のパッケージが持つ別の isolate での処理などは要らない。種類の選び方(マイクの権限の有無)、Android 14 の制限への対処、タスクを消したときの止め方を、手元のコードで確かめられるほうを選んだ。livekit_client の README の例(`flutter_background`)は画面共有(mediaProjection)向け |
| `image_picker` | 公式(flutter.dev)のパッケージで、写真ライブラリ(iOS は PHPicker、Android は Photo Picker。どちらも権限が要らない)とカメラから選ぶ。`imageQuality` / `maxWidth` で画像を縮め、JPEG にできる(設計メモの「端末での圧縮」) |
| `video_compress` | 動画を端末で H.264 の MP4 にし、進み具合とサムネイルを出す(設計メモの「画像・動画の処理」)。iOS は `AVAssetExportSession`(`shouldOptimizeForNetworkUse` で `moov` を先頭に置く)、Android は Transcoder(MediaCodec)で、どちらも OS の符号化器を使い、GPL の x264 を含まない。FFmpegKit はアーカイブされ、後継の GPL 版はアプリを GPL にする。Swift Package Manager に対応していないので、iOS は CocoaPods を併用する。Kotlin Gradle Plugin を使うプラグインとして Flutter の警告が出る(livekit_client と同じ) |
| `video_player` | 公式のパッケージで、iOS は AVPlayer、Android は ExoPlayer で、URL を読みながら再生する(設計メモの「画像・動画の処理」) |
| `image` | サムネイル(JPEG)を作る、API が受け付けない形式(GIF など)を JPEG にする。Dart だけで書かれていて、ネイティブのコードが無く、`flutter test` でそのまま試せる。別の isolate で動かす。HEIC は読めない |
| `http` | 署名付き URL への PUT(進み具合を出すため、ストリームで送る)。生成したクライアントも使っている。以前は統合テストのためだけに dev_dependencies に入れていた |
| `fake_async`(テスト) | 送り直しのタイマーを、時間を進めて試す |

## テスト

字幕の組み立て、送り直し、購読の決め方、画像・動画(形式の見分け、サムネイル、PUT、段階ごとのやり直し、重ねない表示、送信中の表示、配信の受信と履歴での確かめ)を単体テストと widget テストにしている。

```sh
flutter analyze
flutter test
```

## 統合テスト

`integration_test/room_flow_test.dart` は、ローカルの環境(API、模擬 OIDC、LiveKit、Agent)につないで、プロフィールの登録、入室、入室直後のテキスト、PTT、英語の話者の字幕、履歴までを、シミュレーター(またはエミュレーター)の上の本物のアプリで通す。ログインだけは、ブラウザを操作できないので、模擬 OIDC のフォームを直接送ってトークンを取る。OpenAI を使うので課金される(1回で数セント)。

1. ルーム `mobile-test`(名前「モバイル確認」、メンバーに `alice`)を作っておく。
2. devContainer で相手役を待たせる。アプリが入室するのを待ってから、英語の話者として WAV を流す(ルームはアプリのトークンで作らせるため、先には入らない)。

   ```sh
   mise x -- apps/mobile/integration_test/speak_when_joined.sh
   ```

3. ホストで実行する。

   ```sh
   flutter test integration_test/room_flow_test.dart -d <シミュレーターの ID> --dart-define=DEV_HOST=<DEV_HOST>
   ```

   Android では、`flutter test` がアプリを入れ直すたびに権限が消え、マイクの権限のダイアログで入室が止まる。入ったらすぐ権限を与えるよう、別のターミナルで先に次を動かしておく(`send_home_when_joined.sh` は同じことを自分で行う)。

   ```sh
   until adb shell pm list packages | grep -q jp.voiceintercom.voice_intercom; do sleep 0.2; done
   adb shell pm grant jp.voiceintercom.voice_intercom android.permission.RECORD_AUDIO
   adb shell pm grant jp.voiceintercom.voice_intercom android.permission.POST_NOTIFICATIONS
   ```

### 画像・動画

`integration_test/media_upload_test.dart` は、入室して、作った JPEG(1MB 超え。サムネイルも作る)を送り、complete の応答でルームの表示に出ること、タップで全画面に開くこと、履歴に出ることを確かめる。`image_picker` の画面は操作できないので、`RoomScreenState.uploader` にファイルを直接渡す(整える・uploads・PUT・complete は本物を通る)。Agent と相手役は要らない(ルーム `mobile-test` は要る)。SeaweedFS に PUT し、`MEDIA_BASE_URL` から読む。

```sh
flutter test integration_test/media_upload_test.dart -d <シミュレーターの ID> --dart-define=DEV_HOST=<DEV_HOST>
```

`integration_test/media_receive_test.dart` は、入室した後に、別の参加者(相手役。`--dart-define=TEST_PEER=...`、既定は `bob`)として API を直接呼んで画像を送り(uploads・PUT・complete。相手役のトークンで `MediaUploader` を使う)、配信で届いた画像が、入り直しも履歴の読み直しもせずにルームの表示に出ること、送信者が相手役であること、complete をやり直しても重ならないこと、タップで全画面に開くことを確かめる。相手役は LiveKit のルームに入らない。相手役がルームのメンバーにいなければ、テストが管理者のトークン(模擬 OIDC の `cognito:groups: ["admin"]`)で足す。Agent は要らない。

```sh
flutter test integration_test/media_receive_test.dart -d <シミュレーターの ID> --dart-define=DEV_HOST=<DEV_HOST>
```

### バックグラウンドでの音声(Android)

`integration_test/background_test.dart` は、入室したままホームに戻り、裏にいる間に別の参加者(相手役)の字幕と訳が届くこと、前面に戻ると出ていること、退室でサービスが止まることを確かめる。ホームに戻す・前面に戻すのは、ホストの `send_home_when_joined.sh` が adb で行う。テストの合図(`BG_TEST:`)は `flutter test` の出力に出る(統合テストの print は logcat には出ない)ので、出力をパイプで渡す。

1. 上の 1. と 2. と同じ(相手役は1回の実行ごとに起動し直す)。
2. ホストで実行する。

   ```sh
   flutter test integration_test/background_test.dart -d emulator-5554 --dart-define=DEV_HOST=<DEV_HOST> 2>&1 \
     | integration_test/send_home_when_joined.sh
   ```

スクリプトは、裏にいる間と退室の後に、サービス(`types=0x00000082` は microphone と mediaPlayback)、プロセスの状態(`curProcState=4` はフォアグラウンドサービス)、再生(`state:started`)、録音(`not silenced` ならマイクは止められていない)を表示する。退室の後は「(サービスなし)」と `rec stop` になる。

ユーザーとルームの名前は `--dart-define=TEST_USER=...`、`TEST_ROOM_NAME=...` で変えられる。

iOS シミュレーターで、音声を開いた時点で `SetProperty: RPC timeout. Apparently deadlocked. Aborting now.`(CoreAudio)と出てアプリが落ちることがある。iOS の WebRTC は再生だけでもマイクと一緒に開くので、ホスト Mac の音声の環境の影響を受ける。仮想オーディオのドライバー(`/Library/Audio/Plug-Ins/HAL/` の Teams など)が原因になりうる。

## 実機で確かめること

エミュレーター・シミュレーターでは確かめられないもの。

- iOS の `inputMixer` で、ミュートの切り替えにミュート音が鳴らないか、押してすぐ声が乗るか(冒頭が欠けないか)。
- 2台で PTT をして、相手のアプリで元の音声と翻訳音声が聞こえるか、話していない間に音が漏れていないか。
- 入室してすぐテキストを送り、送り直しで字幕が出るか(「送信中(2回目)」の後に字幕が出る)。
- イヤホンとスピーカーの切り替え、Bluetooth のヘッドセット。
- 画像・動画(下の「画像・動画(実機)」)。
- バックグラウンドでの音声(iOS はシミュレーターの音声が落ちるので、実機で確かめる。Android も実機で一度確かめる)。2台で同じルームに入り、片方(確かめる側)を次の状態にして、もう片方が話す。
  1. ホームに戻す。元の音声と翻訳音声が聞こえ続けるか。前面に戻すと、裏にいた間の字幕が出ているか。
  2. 画面をロックする。1. と同じ。iOS ではロック画面に再生中の表示が出るか、Android では「入室中」の通知が出ているか。
  3. 裏に回したまま5分以上置く。切れずに聞こえ続けるか(iOS は audio mode でも、音声が途絶えるとアプリが停止されることがある)。
  4. 裏にいる間に電話がかかってきたら(または別のアプリで音楽を鳴らしたら)、終わった後に音声が戻るか。
  5. Bluetooth のヘッドセットをつないだまま 1. と 2.。音声がヘッドセットに出続けるか。
  6. 退室すると、Android の通知が消え、iOS のステータスバーのマイクの表示(オレンジの点)が消えるか。アプリを上にスワイプして終了しても同じか。
  7. Android 14 以降で、マイクの権限を「今回のみ」にして入室し、裏に回ってもマイクが止められないか。

### 画像・動画(実機)

設計メモの「確かめること」のうち、アプリで確かめるもの。

1. **HEIC**(iOS): iPhone で撮った HEIC の写真をライブラリから選ぶ。`imageQuality` を渡しているので JPEG になって届くか(管理コンソールの Chrome で表示できるか、履歴の `content_type` が `image/jpeg` か)。HEIC のまま届いたら、`image/heic` でサムネイルなしになる。そのとき、アプリ(iOS と Android)で表示できるか。
2. **大きな画像**: 4000px 級の写真が、長い辺 2048px の JPEG に縮むか。1MB を超えたらサムネイルが付くか。向き(EXIF)がサムネイルと全画面で合っているか。PNG のスクリーンショットも。
3. **動画の圧縮**: iPhone の HEVC の MOV(4K、60fps)と Android の動画を選び、H.264 の MP4(1280x720 まで)になるか。圧縮の時間、進み具合、圧縮後の大きさ、音声が残るか。縦の動画の向き。3分を超える動画が「3分まで」で止まるか。
4. **読みながらの再生**: 送った動画を、もう1台で開き、全部を読む前に再生が始まるか。iOS は `shouldOptimizeForNetworkUse` で `moov` が先頭に来るはず。Android の出力(Transcoder、MediaMuxer)は `moov` が末尾になる見込み(未確認)で、そうなら全部を読むまで始まらない。`ffprobe -v trace` か `AtomicParsley -T` で確かめる。
5. **カメラ**: 写真と動画を撮って送れるか。権限のダイアログ(iOS のカメラとマイク)。
6. **失敗とやり直し**: 送信中に機内モードにして「送れなかった」が出るか、戻して「やり直す」で続きから送れるか(圧縮をやり直さない)。
7. **裏に回したとき**: 圧縮・アップロードの途中でホームに戻ると止まるか(今は裏での続きを考えていない)。
8. 管理コンソールで、アプリから送った画像・動画が表示・再生できるか。
9. **配信の受信**: 2台で同じルームに入り、片方が送った画像・動画が、もう片方にすぐ出るか。AWS の dev 環境では履歴の読み込みが結果整合なので、読み直し(1秒後・3秒後)で足りるか(ログに「履歴に無い画像・動画の知らせを捨てた」が出ないか)。管理コンソールから上げたものも出るか。

