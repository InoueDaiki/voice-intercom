// 入口。LiveKit の globals を、ほかの import より先に入れる
import "react-native-get-random-values";
// JS が起動した時刻を、なるべく早く記録する
import "./src/log";

import { registerGlobals } from "@livekit/react-native";
import { pttChannel } from "@voice-intercom/intercom-os";
import { registerRootComponent } from "expo";

// Push to Talk の仕組みがあるときは、音声セッションを LiveKit に触らせない(システムが有効にする)。
// 無い環境(シミュレーターのビルドでモジュールが無いとき、Android)では LiveKit に任せる
registerGlobals({ autoConfigureAudioSession: pttChannel === undefined });

// registerGlobals の後に読み込む(livekit-client が globals を使う)
const { default: App } = require("./App") as typeof import("./App");

registerRootComponent(App);
