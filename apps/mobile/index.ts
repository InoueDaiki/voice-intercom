// 入口。LiveKit の globals を、ほかの import より先に入れる
import "react-native-get-random-values";

import { registerGlobals } from "@livekit/react-native";

// 音声セッションは LiveKit に任せる。Push to Talk の仕組みを入れるときは、システムに任せる(tools/ptt-poc)
registerGlobals();

// registerGlobals の後に読み込む(livekit-client が globals を使う)
require("expo-router/entry");
