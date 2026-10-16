// RoomSession に差し込む、ブラウザでの音声の出し方。
// React Native は SDK が音声を鳴らすので、モバイル版では要らない。
import type { RoomPlatform } from "@voice-intercom/client-core";

export const webRoomPlatform: RoomPlatform = {
  // 購読した音声トラックを <audio> に付けて鳴らす。画面には出さない
  attachAudio(track) {
    const el = track.attach();
    el.hidden = true;
    document.body.appendChild(el);
  },
  detachAudio(track) {
    for (const el of track.detach()) {
      el.remove();
    }
  },
  // Web 版はタブを開いている間だけ使う(設計メモの「Web 版で決めたこと」)ので、バックグラウンドは扱わない
};
