// RoomSession・RoomKeeper に差し込む、端末に依るところ(音声の出し方、アプリの見え方、画面を消させない)。
// 購読した音声は LiveKit の SDK が鳴らすので、attachAudio は要らない。
// バックグラウンドで音声を保つ(startBackground)と、通知から話す仕組みは、OS とのやり取り(packages/intercom-os)の
// 実機での確認が済んでから入れる(設計メモの「React Native かネイティブか、と Push to Talk の spike」)
import type { AppPresence, PresenceChange, RoomPlatform, ScreenAwake } from "@voice-intercom/client-core";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { AppState, type AppStateStatus } from "react-native";

export const mobileRoomPlatform: RoomPlatform = {};

function presenceOf(state: AppStateStatus): PresenceChange {
  switch (state) {
    case "active":
      return "visible";
    // 通知センターやアプリの切り替え画面を出している間。PTT を離す
    case "inactive":
      return "inactive";
    default:
      return "hidden";
  }
}

// 端末の画面(写真のピッカー、カメラ)を開いている数。Android ではこれらの間もアプリが裏に回った扱いになるが、
// 利用者はアプリを離れていないので、「離れていた間」のお知らせを出さない
let systemUiOpen = 0;
const presenceListeners = new Set<(change: PresenceChange) => void>();

export async function whileSystemUiOpen<T>(open: () => Promise<T>): Promise<T> {
  systemUiOpen++;
  try {
    return await open();
  } finally {
    systemUiOpen--;
    // 開いている間に切れていれば入り直せるよう、戻ったことを知らせる
    if (systemUiOpen === 0 && AppState.currentState === "active") {
      for (const l of presenceListeners) {
        l("visible");
      }
    }
  }
}

// アプリが前にあるか。裏に回ったら(今はバックグラウンドの音声が無いので)PTT を離し、戻ったら入り直す
export const mobileAppPresence: AppPresence = {
  isVisible: () => AppState.currentState === "active",
  subscribe(listener) {
    presenceListeners.add(listener);
    const sub = AppState.addEventListener("change", (state) => {
      const change = presenceOf(state);
      // PTT は必ず離す(プライバシーのため)ので、hidden だけを inactive に読み替える
      listener(systemUiOpen > 0 && change === "hidden" ? "inactive" : change);
    });
    return () => {
      presenceListeners.delete(listener);
      sub.remove();
    };
  },
};

const KEEP_AWAKE_TAG = "room-audio";

// 音声をつないでいる間、画面を勝手に消させない
export function mobileScreenAwake(): ScreenAwake {
  return {
    acquire() {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch((e: unknown) => console.info("画面を点けたままにできなかった", e));
    },
    release() {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch((e: unknown) =>
        console.info("画面を点けたままにするのをやめられなかった", e),
      );
    },
  };
}
