# Push to Talk の spike(iOS)

React Native のままモバイル版を作れるかを決めるための spike。iOS の Push to Talk の仕組み(PushToTalk フレームワーク)と、LiveKit の React Native SDK と、client-core の `RoomSession` を、1つのアプリで合わせて動かす。本番のアプリ(`apps/mobile`)には入れない。確かめることと結果を書く表は、設計メモの「Push to Talk の spike」にある。

OS とのやり取りは `packages/intercom-os` にある(本体は React Native に依らない Swift。[packages/intercom-os/README.md](../../packages/intercom-os/README.md))。この PoC はそれを使う側で、LiveKit の接続は JS(client-core)が持つ。

## 準備

実機が要る。Push to Talk の仕組みと PTT の push は、シミュレーターでは動かない(シミュレーターではビルドと画面だけを確かめられる)。

1. iPhone か iPad(iOS / iPadOS 16.4 以上。Expo 58 の下限)。
2. Apple Developer Program(有料)。次を作る。
   - **App ID**: Capabilities の **Push to Talk** と **Push Notifications** を有効にする。bundle ID を `.env` の `PTT_POC_BUNDLE_ID` に書く。
   - **Keys**: APNs のキー(.p8)を作る。リポジトリの外に置き、パスを `APNS_KEY_FILE`、Key ID を `APNS_KEY_ID` に書く。
   - Team ID を `APPLE_TEAM_ID` に書く。
3. ホストのツールは mise が入れる(Ruby と CocoaPods。`mise install`)。Xcode は別に入れる。
4. ローカルの環境(devContainer の `mise run dev`)を動かし、端末を Mac と同じ LAN につなぐ。アプリはビルドのときの `DEV_HOST` につなぐ。
5. 入るルームを管理コンソールで作り、使う利用者(`user1` など)をメンバーにしておく。

## 起動

ホスト(Mac)で:

```sh
mise run poc:ptt:ios --device   # 初回は prebuild と pod install も行う。端末を選ぶ
mise run poc:ptt                # 2回目からは Metro だけでよい(ネイティブを変えたらビルドし直す)
```

`ios/` は prebuild が作るので、コミットしない(`app.config.ts` と設定プラグインを変えたら `pnpm --dir tools/ptt-poc prebuild --clean` で作り直す)。

**時間を測るときは Release でビルドする**(`mise run poc:ptt:ios --device --configuration Release`)。Debug は JS を Metro から LAN 越しに読むので、閉じたアプリを起こしたときの JS の起動が実際より遅くなる。

## 使い方

1. **入室**: username(`user1` など)と room_id を入れて「入室」。模擬 OIDC の password grant でトークンを取り、API の `POST /livekit/token` で LiveKit に入る。設定は端末に残り、閉じたアプリを push で起こしたときもこれで入り直す。
2. **チャンネルに参加**: 「参加」。前面にいるときにしか参加できない(Apple の決まり)。参加すると「push の宛先」にトークンが出る。
3. **話す**: 「押して話す」か、システムの画面(ロック画面・Dynamic Island の話すボタン)から話す。どちらも `transmissionBegan` を経て `RoomSession.setPressing(true)` になる。
4. **受ける**: Web 版など別の端末から同じルームで話す。LiveKit の active speakers を見て `setActiveRemoteParticipant` を呼び、システムに音声セッションを有効にしてもらう。
5. **閉じたアプリで受ける**: アプリを裏に回すか、アプリの切り替えで閉じてから、push を送る。

   ```sh
   mise run poc:ptt:push --token <push の宛先> --speaker user2
   mise run poc:ptt:push --token <push の宛先> --leave   # チャンネルから出させる
   ```

   push を受けると、システムが「話している人」を出し、アプリが起きて入室し直す。「最後の push からの経過」に、JS の起動、音声セッションの有効化、ログイン、トークン、入室、音声の購読、話している人が見えるまでの時間が出る。
6. **記録**: 「記録を共有(JSON)」で出来事をすべて書き出せる(時刻は UNIX 時間のミリ秒。push のスクリプトが出す `sentAtMs` と突き合わせられる)。

## 作り

| パス | 内容 |
| --- | --- |
| `index.ts` | 入口。Push to Talk があるときは、LiveKit の音声セッションの自動の設定を切る(`registerGlobals({ autoConfigureAudioSession: false })`) |
| `src/pttController.ts` | spike の中心。intercom-os の出来事を `RoomSession` と WebRTC の音声エンジンにつなぐ |
| `src/log.ts` | 出来事の記録と、push からの経過 |
| `src/settings.ts` | 端末に残す設定と、接続先(`DEV_HOST`) |
| `App.tsx` | 画面 |
| `app.config.ts` | Expo の設定。bundle ID・Team ID・接続先を `.env` から読む |
| `scripts/send_ptt_push.py` | PTT の push を APNs に直接送る(`mise run poc:ptt:push`) |

### 音声のつなぎ方

Push to Talk の仕組みでは、アプリが自分で音声セッションを有効にしてはいけない。そこで:

- 起動したら、WebRTC の音声エンジンを止めておく(`AudioDeviceModule.setEngineAvailability` で入力・出力とも不可)。
- システムが有効にしたら(`audioActivated`)、`RTCAudioSession.audioSessionDidActivate()` を呼び、エンジンを動かす。
- 無効にしたら(`audioDeactivated`)、エンジンを止め、`audioSessionDidDeactivate()` を呼ぶ。

`@livekit/react-native-webrtc`(150.1.1)は、エンジンの出来事に JS のハンドラーが無ければ JS の応答を待たない(ソースで確かめた)ので、自動の設定を切ってもエンジンの起動は遅れない。
