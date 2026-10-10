# apps/mobile

Flutter のアプリ(iOS / Android)。ホストで開発する(devContainer には Flutter を入れない)。版は `mise.toml` で固定している。

今あるのは動く最小の骨組み。push 通知、画像・動画の送信、バックグラウンドでの音声の維持、iOS の PushToTalk フレームワークは、まだ入れていない。

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

- `mise.toml` の `github:livekit/livekit`(1.13.9)は macOS 向けのバイナリが配布されていないので、ホストの `mise install` / `mise x` / `mise run livekit` がその取得で失敗する。直るまでは、Flutter は `~/.local/share/mise/installs/flutter/<版>/bin` を PATH に足して使い、LiveKit サーバーは公式のイメージで動かす。

  ```sh
  docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
    livekit/livekit-server:v1.13.9 --dev --bind 0.0.0.0 --node-ip "$DEV_HOST"
  ```

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
| `lib/screens/` | ログイン、プロフィール、ルームの一覧、ルーム、履歴 |

型は生成物を使う。REST は `packages/api-client/dart`、データチャネルのメッセージは `packages/schema/dart`(どちらも path で参照し、手で編集しない)。

## ルームでの振る舞い

`services/agent/README.md` の「ルームとの取り決め」に合わせている。

- **PTT**: 入室したらマイクのトラックを publish する。publish の前にミュートしておくので、ミュートのまま publish され、音は漏れない。押している間だけミュートを外す。ミュートの操作は1つずつ順に、必ず await する(設計メモの「PTT の方式」)。iOS では接続の前に `AudioManager.instance.setMicrophoneMuteMode(MicrophoneMuteMode.inputMixer)` にし(OS のミュート音が鳴らない)、トラックは `stopAudioCaptureOnMute: false` で作る(ミュートでマイクを止めず、外すのが速い)。Android では `setMicrophoneMuteMode` は何もしない。
- **聞く**: `autoSubscribe` を切り、Agent 以外の参加者のマイクのトラックと、Agent の `translation-<自分の言語>` だけを購読する。
- **字幕**: topic `caption` の `Caption` を `(segment_id, language, translated)` ごとに連結し、確定で置き換える(空の確定は消す)。区切り(`segment_id`)ごとに、原文と自分の言語の訳を並べる。話者と同じ言語なら訳は出ない(Agent が作らない)。
- **テキスト入力**: topic `text` で `TextMessage` を送る。入室の直後(約3秒以内)に送ると、Agent が送信元を知らずに捨てることがある(設計メモの「Agent の結合確認」)。Agent は受け付けるとすぐ原文の字幕を `message_id` 付きで配信するので、自分の `message_id` の字幕が4秒のうちに届かなければ、同じ `message_id` で送り直す(3回まで。だめなら「届かなかった」と出す)。Agent は同じ `(identity, message_id)` を1回だけ処理する。
- **履歴**: `GET /rooms/{room_id}/timeline` を50件ずつ、`next_before` で古いほうへ読む。

## パッケージを選んだ理由

| パッケージ | 理由 |
| --- | --- |
| 状態管理・ルーティングのパッケージは使わない | 画面は5つで、状態はログインの段階とルームの接続の2つだけ。Flutter の `ChangeNotifier` と `ListenableBuilder`、`Navigator` で足りる。画面と状態が増えたら見直す |
| `livekit_client` | 公式の SDK(設計メモの「LiveKit の設計」)。`setMicrophoneMuteMode` が要るので 2.9.0 以降 |
| `flutter_appauth` | 標準の OIDC(探索、認可コード + PKCE、リフレッシュ)を AppAuth(iOS / Android の公式ライブラリ)で行う。Cognito 専用の SDK を使わないので、模擬 OIDC と同じコードで動く。iOS は Cookie を共有しないブラウザ(ephemeral)でログインする |
| `flutter_secure_storage` | リフレッシュトークンを Keychain / Keystore に置く |
| `protobuf` | `packages/schema/dart` の実行時ライブラリ |
| `fake_async`(テスト) | 送り直しのタイマーを、時間を進めて試す |

## テスト

字幕の組み立て、送り直し、購読の決め方を単体テストにしている。

```sh
flutter analyze
flutter test
```

## 実機で確かめること

エミュレーター・シミュレーターでは確かめられないもの。

- iOS の `inputMixer` で、ミュートの切り替えにミュート音が鳴らないか、押してすぐ声が乗るか(冒頭が欠けないか)。
- 2台で PTT をして、相手のアプリで元の音声と翻訳音声が聞こえるか、話していない間に音が漏れていないか。
- 入室してすぐテキストを送り、送り直しで字幕が出るか(「送信中(2回目)」の後に字幕が出る)。
- イヤホンとスピーカーの切り替え、Bluetooth のヘッドセット。
