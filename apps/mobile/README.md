# apps/mobile

Flutter のアプリ(iOS / Android)。ホストで開発する(devContainer には Flutter を入れない)。版は `mise.toml` で固定している。

今あるのは動く最小の骨組み。push 通知、画像・動画の送信、iOS の PushToTalk フレームワークは、まだ入れていない。入室中は、バックグラウンドでも音声を保つ(下の「バックグラウンドでの音声」)。

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
| `lib/room/background_audio.dart` | 入室中のバックグラウンドでの音声(Android はフォアグラウンドサービスを動かす) |
| `android/app/src/main/kotlin/.../InRoomService.kt` | Android の入室中のフォアグラウンドサービスと通知。`MainActivity.kt` の MethodChannel(`voiceintercom/in_room`)から始め、止める |
| `lib/screens/` | ログイン、プロフィール、ルームの一覧、ルーム、履歴 |

型は生成物を使う。REST は `packages/api-client/dart`、データチャネルのメッセージは `packages/schema/dart`(どちらも path で参照し、手で編集しない)。

## ルームでの振る舞い

`services/agent/README.md` の「ルームとの取り決め」に合わせている。

- **PTT**: 入室したらマイクのトラックを publish する。publish の前にミュートしておくので、ミュートのまま publish され、音は漏れない。押している間だけミュートを外す。ミュートの操作は1つずつ順に、必ず await する(設計メモの「PTT の方式」)。iOS では接続の前に `AudioManager.instance.setMicrophoneMuteMode(MicrophoneMuteMode.inputMixer)` にし(OS のミュート音が鳴らない)、トラックは `stopAudioCaptureOnMute: false` で作る(ミュートでマイクを止めず、外すのが速い)。Android では `setMicrophoneMuteMode` は何もしない。
- **聞く**: `autoSubscribe` を切り、Agent 以外の参加者のマイクのトラックと、Agent の `translation-<自分の言語>` だけを購読する。
- **字幕**: topic `caption` の `Caption` を `(segment_id, language, translated)` ごとに連結し、確定で置き換える(空の確定は消す)。区切り(`segment_id`)ごとに、原文と自分の言語の訳を並べる。話者と同じ言語なら訳は出ない(Agent が作らない)。
- **テキスト入力**: topic `text` で `TextMessage` を送る。入室の直後(約3秒以内)に送ると、Agent が送信元を知らずに捨てることがある(設計メモの「Agent の結合確認」)。Agent は受け付けるとすぐ原文の字幕を `message_id` 付きで配信するので、自分の `message_id` の字幕が4秒のうちに届かなければ、同じ `message_id` で送り直す(3回まで。だめなら「届かなかった」と出す)。Agent は同じ `(identity, message_id)` を1回だけ処理する。
- **履歴**: `GET /rooms/{room_id}/timeline` を50件ずつ、`next_before` で古いほうへ読む。

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
| `fake_async`(テスト) | 送り直しのタイマーを、時間を進めて試す |

## テスト

字幕の組み立て、送り直し、購読の決め方を単体テストにしている。

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
- バックグラウンドでの音声(iOS はシミュレーターの音声が落ちるので、実機で確かめる。Android も実機で一度確かめる)。2台で同じルームに入り、片方(確かめる側)を次の状態にして、もう片方が話す。
  1. ホームに戻す。元の音声と翻訳音声が聞こえ続けるか。前面に戻すと、裏にいた間の字幕が出ているか。
  2. 画面をロックする。1. と同じ。iOS ではロック画面に再生中の表示が出るか、Android では「入室中」の通知が出ているか。
  3. 裏に回したまま5分以上置く。切れずに聞こえ続けるか(iOS は audio mode でも、音声が途絶えるとアプリが停止されることがある)。
  4. 裏にいる間に電話がかかってきたら(または別のアプリで音楽を鳴らしたら)、終わった後に音声が戻るか。
  5. Bluetooth のヘッドセットをつないだまま 1. と 2.。音声がヘッドセットに出続けるか。
  6. 退室すると、Android の通知が消え、iOS のステータスバーのマイクの表示(オレンジの点)が消えるか。アプリを上にスワイプして終了しても同じか。
  7. Android 14 以降で、マイクの権限を「今回のみ」にして入室し、裏に回ってもマイクが止められないか。

