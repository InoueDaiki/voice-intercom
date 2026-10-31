// テキストの欄と操作の部品の外で Space を押している間、音声をつないだ全部のルームに話す。
// ボタンやリンクにフォーカスがあるときの Space は、その操作に渡す(キーボードで操作する人のため)。
// PTT のキー(data-ptt)はマウスで押すとフォーカスが残るが、Space でも話せるよう、取り上げる。
// 押したままタブを離れた・画面を消したときに離すのは RoomKeeper(blur、visibilitychange、pagehide を聞く)
import { pressAll, useRoomHub } from "@voice-intercom/client-react";
import { useEffect } from "react";

export function SpacePtt(): null {
  const hub = useRoomHub();
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-ptt]")) {
        return false;
      }
      return (
        el?.closest(
          'input, textarea, select, [contenteditable], button, a[href], summary, [role="button"], [role="radio"], [role="checkbox"]',
        ) != null
      );
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTyping(e) && hub.audioRooms.length > 0) {
        e.preventDefault();
        pressAll(hub, true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && hub.pressingAny) {
        e.preventDefault();
        pressAll(hub, false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [hub]);
  return null;
}
