// 音声をつないだルームが1つでもある間、端末の音声セッションを開いておく(LiveKit の React Native SDK は、
// 開かないと受け取った声を鳴らさない)。全部を切ったら閉じる(ほかのアプリの音を止めたままにしない)。
// Push to Talk の仕組みを入れるときは、システムが音声セッションを開くので、ここは使わない(tools/ptt-poc)
import { AudioSession } from "@livekit/react-native";
import { useRoomHub } from "@voice-intercom/client-react";
import { useEffect } from "react";

export function AudioSessionKeeper(): null {
  const hub = useRoomHub();
  const active = hub.audioRooms.length > 0;
  useEffect(() => {
    if (!active) {
      return;
    }
    AudioSession.startAudioSession().catch((e: unknown) => console.warn("音声セッションを開けなかった", e));
    return () => {
      AudioSession.stopAudioSession().catch((e: unknown) => console.info("音声セッションを閉じられなかった", e));
    };
  }, [active]);
  return null;
}
