# @voice-intercom/client-core

クライアントの、画面を持たない処理。Web 版(`apps/web`)とモバイル版(`apps/mobile`。React Native、後から作る)で使い回す。Flutter 版(タグ `flutter-final` の `apps/mobile/lib/room`、`lib/media`)から移した。仕様の説明は `git show flutter-final:apps/mobile/README.md` の「ルームでの振る舞い」「送ったものの削除」「画像・動画」と同じ。

## 構成

| ファイル | 内容 | Flutter 版 |
| --- | --- | --- |
| `src/api.ts` | 利用者向けの REST API(`createClientApi`)、`ApiError`、型、言語 | `lib/api.dart` |
| `src/observable.ts` | 状態が変わったことを画面に知らせる(`subscribe`、`version`) | `ChangeNotifier` |
| `src/room/roomSession.ts` | 1つのルームへの接続(`livekit-client`)。PTT、購読、字幕、テキスト入力、画像・動画の受け取り、削除 | `lib/room/room_session.dart` |
| `src/room/subscription.ts` | 購読するトラックの決め方 | `lib/room/subscription.dart` |
| `src/room/captionBoard.ts` | 字幕の断片の連結と確定、消したテキスト | `lib/room/caption_board.dart` |
| `src/room/textSender.ts` | テキスト入力の送り直しと `TextStatus` | `lib/room/text_sender.dart` |
| `src/room/mediaFeed.ts` | ルームの表示の画像・動画、字幕との並べ方 | `lib/room/media_feed.dart` |
| `src/room/mediaReceiver.ts` | topic `media` を履歴で確かめてから出す | `lib/room/media_receiver.dart` |
| `src/room/deletionReceiver.ts` | topic `deletion` を履歴で確かめてから反映する | `lib/room/deletion_receiver.dart` |
| `src/room/deletionLabels.ts` | 「削除された…」の言い方 | `lib/screens/deletion_widgets.dart` の一部 |
| `src/media/mediaUploader.ts` | 画像・動画の送信(整える → uploads → PUT → complete。マルチパートは同時に4本、上限 10GB) | `lib/media/media_uploader.dart`、`api_media_backend.dart` |
| `src/media/mediaType.ts` | 先頭のバイトで形式を見分ける | `lib/media/media_type.dart` |
| `src/media/preparedMedia.ts` | 整えた画像・動画の形、上限、`MediaPreparer` | `lib/media/media_preparer.dart` の一部 |
| `src/media/signedPut.ts` | 署名付き URL への PUT の口(`SignedPut`) | `lib/media/http_put.dart` の取り決め |

## 端末に依るところ(各アプリが差し込む)

DOM の API は使わない。`tsconfig.json` の `lib` に DOM を入れず、ブラウザと React Native の両方にあるもの(`setTimeout`、`console`、`crypto.getRandomValues`)だけを `src/host.d.ts` で宣言している。`document` や `XMLHttpRequest` を書くと型検査で落ちる。

| 口 | 内容 | Web 版 | モバイル版(予定) |
| --- | --- | --- | --- |
| `ClientApiOptions.getAccessToken` | ログインとトークンの更新 | `oidc-client-ts` | 未定 |
| `RoomPlatform.attachAudio` / `detachAudio` | 購読した音声を鳴らす | `track.attach()` の `<audio>` を置く | 要らない(SDK が鳴らす) |
| `RoomPlatform.startBackground` / `stopBackground` | 入室中のバックグラウンドの音声 | 無し | フォアグラウンドサービス、iOS の音声のバックグラウンド |
| `MediaPreparer` | 選んだものを送る形に整える(サムネイル、幅・高さ、動画の変換) | まだ無い | 未定 |
| `SignedPut` | 本体の範囲を読みながらの PUT と進み具合 | まだ無い(`Blob.slice` と `XMLHttpRequest` の予定) | 未定 |

- `crypto.getRandomValues`(テキストの `message_id`)は、React Native では `react-native-get-random-values` などで足す。
- `livekit-client` は peerDependency。React Native では `@livekit/react-native`(`livekit-client` を前提にしている)と一緒に入れる。iOS のミュートのモード(`setMicrophoneMuteMode`)のような端末だけの設定は、モバイル版で足す。

## Flutter 版から移していないもの

- 画面(`lib/screens`)と、その単体テスト(`media_widgets_test`、削除の確認のダイアログ)。
- 端末の処理: 画像の整え方(`media_preparer.dart` の `DeviceMediaPreparer`)、動画の変換(`video_plan.dart`、`video_transcoder.dart`)、バックグラウンドの音声(`background_audio.dart`)、HTTP の PUT(`http_put.dart`)。Web 版は動画をまず変換せずに送る(設計メモの「Web 版で決めたこと」)。
- iOS シミュレーター向けの音声の回避(`room_session.dart` の `_initWebrtc`)。

## テスト

`pnpm --dir packages/client-core test`(Vitest。Node で動かす)。Flutter 版の単体テスト(`caption_board_test`、`text_sender_test`、`media_receiver_test`、`deletion_test`、`media_feed_test`、`media_type_test`、`media_uploader_test`、`subscription_test`、`room_session_*_test`)を移した。`fakeAsync` は Vitest の偽のタイマー(`vi.advanceTimersByTimeAsync`)に置き換えた。
