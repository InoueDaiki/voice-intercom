// RoomSession・RoomKeeper に差し込む、ブラウザに依るところ(音声の出し方、画面の見え方、画面を消させない)。
// React Native は SDK が音声を鳴らすので、モバイル版では attachAudio は要らない。
import type { AppPresence, RoomPlatform, ScreenAwake } from "@voice-intercom/client-core";

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

// ページの見え方。PTT を確実に離すため、隠れる合図(visibilitychange の hidden、pagehide)と
// フォーカスを失う合図(blur)を全部聞く。マウスで押したままタブを切り替えた、画面を消した、でも離れる。
// 戻る合図は visibilitychange の visible と、bfcache から戻った pageshow
export const webAppPresence: AppPresence = {
  isVisible: () => document.visibilityState === "visible",
  subscribe(listener) {
    const onVisibility = () => listener(document.visibilityState === "visible" ? "visible" : "hidden");
    const onPageHide = () => listener("hidden");
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        listener("visible");
      }
    };
    const onBlur = () => listener("inactive");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("blur", onBlur);
    };
  },
};

// Screen Wake Lock で画面を勝手に消させない。使えないブラウザ・断られたとき(省電力のモード、
// HTTPS でない、隠れている)は何もしない。ページが隠れるとブラウザが外すので、RoomKeeper が戻ったときに取り直す
export function webScreenAwake(): ScreenAwake {
  let sentinel: WakeLockSentinel | undefined;
  let requesting = false;
  // 最後に求められた状態。取っている途中に放すよう求められたら、取れた後で放す
  let wanted = false;
  // 断られたら、放すまで(隠れて戻るまで)求め直さない(状態が変わるたびに求めて断られ続けないよう)
  let refused = false;
  return {
    acquire() {
      wanted = true;
      if (!("wakeLock" in navigator) || requesting || refused || (sentinel && !sentinel.released)) {
        return;
      }
      requesting = true;
      navigator.wakeLock
        .request("screen")
        .then((s) => {
          sentinel = s;
          if (!wanted) {
            void s.release();
          }
        })
        .catch((e: unknown) => {
          refused = true;
          console.info("画面を点けたままにできなかった", e);
        })
        .finally(() => {
          requesting = false;
        });
    },
    release() {
      wanted = false;
      refused = false;
      const s = sentinel;
      sentinel = undefined;
      s?.release().catch((e: unknown) => console.info("画面を点けたままにするのをやめられなかった", e));
    },
  };
}
