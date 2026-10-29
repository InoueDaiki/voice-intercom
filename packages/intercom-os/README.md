# intercom-os

OS とのやり取り(iOS の Push to Talk の仕組み。Android の foreground service は後から)を包むネイティブのモジュール。今は spike(`tools/ptt-poc`)だけが使う。

## 線の引き方

- **このモジュールが持つもの**: OS とのやり取りだけ。iOS は `PTChannelManager` の作成と復元、PTT の push の宛先、システムの話すボタンから来る送信の開始・終了、話している人の表示、音声セッションの有効・無効の知らせ。
- **JS(client-core)が持つもの**: LiveKit の接続、ルームの状態、字幕、PTT のミュート。音声セッションを WebRTC につなぐのも JS が行う(`@livekit/react-native-webrtc` の API を呼ぶ)ので、このモジュールは WebRTC に依らない。

本体(`ios/Core`)は React Native にも Expo にも依らない Swift にし、つなぐ層(`ios/Binding`)を薄く別に置く。ネイティブのアプリに移るときは本体をそのまま使い、つなぐ層だけを捨てる。汎用のライブラリにはしない(このアプリの OS とのやり取りを一か所にまとめるのが目的)。

| パス | 内容 |
| --- | --- |
| `ios/Core/PttChannelCore.swift` | 本体。`PTChannelManager` を包み、起きたことを `PttEvent`(起きた時刻つき)にして渡す。JS が起動する前の出来事は貯めておく |
| `ios/Binding/IntercomOsModule.swift` | Expo のモジュール。呼び出しと出来事を受け渡すだけ |
| `ios/Binding/IntercomOsAppDelegateSubscriber.swift` | 起動(`didFinishLaunching`)のたびに、JS を待たずに本体を用意する |
| `src/index.ts` | JS の入口(`pttChannel`)。モジュールが無い環境では `undefined` |
| `app.plugin.js` | Expo の設定プラグイン。`push-to-talk` の background mode、entitlement(`com.apple.developer.push-to-talk`、`aps-environment`)、マイクの説明を足す |

## Apple の決まり(作りに効くもの)

- `PTChannelManager` は起動のたびにすぐ作る。閉じたアプリを push で起こしたときも同じ。
- チャンネルへの参加は、前面にいるときだけ。同時に参加できるのは1つ。
- push を受けたら(`incomingPushResult`)すぐ返す。返した「話している人」を見て、システムが音声セッションを有効にする。
- アプリは音声セッションを自分で有効・無効にしない。カテゴリだけ起動のときに `playAndRecord` にしておく。
- push は APNs の `apns-push-type: pushtotalk`、topic は `<bundle id>.voip-ptt`。宛先はチャンネルに参加すると届くトークンで、FCM のトークンとは別物。
- 既定の送受信は半二重(`halfDuplex`。相手が話している間は話せない)。`setTransmissionMode` で全二重にできる。
