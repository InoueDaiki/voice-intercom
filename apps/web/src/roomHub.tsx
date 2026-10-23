// アプリ全体で1つの RoomHub(ルームの接続をまとめて持つ。client-core の roomHub.ts)。
// 音声をつないだルームは、画面を移ってもつないだままにするため、レイアウト(_app.tsx)で持つ
import { RoomHub, RoomSession, type User } from "@voice-intercom/client-core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { api } from "./api.ts";
import { webAppPresence, webRoomPlatform, webScreenAwake } from "./roomPlatform.ts";
import { useObservable } from "./useObservable.ts";

// 履歴の1ページの件数
const PAGE_LIMIT = 50;

const RoomHubContext = createContext<RoomHub | undefined>(undefined);

export function RoomHubProvider({ me, myIdentity, children }: { me: User; myIdentity: string; children: ReactNode }) {
  const [hub, setHub] = useState<RoomHub>();

  // 言語を変えたら、受け取る翻訳が変わるので、つなぎ直す
  useEffect(() => {
    const h = new RoomHub({
      createSession: (seed) =>
        new RoomSession({
          ...seed,
          myIdentity,
          myLanguage: me.language,
          platform: webRoomPlatform,
          fetchTimelinePage: (before) => api.listTimeline(seed.roomId, { limit: PAGE_LIMIT, before }),
          fetchTimelineEvent: (eventId) => api.getTimelineEvent(seed.roomId, eventId),
          deleteTimelineEvent: (eventId) => api.deleteTimelineEvent(seed.roomId, eventId),
        }),
      // 入室と入り直しのたびに、新しいトークンを取る
      getToken: async (roomId, audio) => {
        const token = await api.createLiveKitToken(roomId, audio);
        return { url: token.server_url, token: token.participant_token };
      },
      setAudioAttribute: (roomId, enabled) => api.setRoomAudio(roomId, enabled),
      presence: webAppPresence,
      awake: webScreenAwake(),
    });
    setHub(h);
    return () => h.dispose();
  }, [myIdentity, me.language]);

  useSpacePtt(hub);
  return hub ? <RoomHubContext value={hub}>{children}</RoomHubContext> : null;
}

// RoomHub を読み、変わったら描き直す
export function useRoomHub(): RoomHub {
  const hub = useContext(RoomHubContext);
  if (!hub) {
    throw new Error("RoomHubProvider の中で使う");
  }
  useObservable(hub);
  return hub;
}

// PTT を押す・離す(音声をつないだ全部のルーム)。押すときに、自動再生で止められた音も鳴らす
export function pressAll(hub: RoomHub, value: boolean): void {
  if (value) {
    for (const r of hub.audioRooms) {
      void r.session.startAudio();
    }
  }
  hub.setPressingAll(value);
}

// 1つのルームだけの PTT
export function pressOne(session: RoomSession, value: boolean): void {
  if (value) {
    void session.startAudio();
  }
  session.setPressing(value);
}

// テキストの欄の外で Space を押している間、音声をつないだ全部のルームに話す。
// 押したままタブを離れた・画面を消したときに離すのは RoomKeeper(blur、visibilitychange、pagehide を聞く)
function useSpacePtt(hub: RoomHub | undefined): void {
  useEffect(() => {
    if (!hub) {
      return;
    }
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return el?.closest("input, textarea, select, [contenteditable]") != null;
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
}
