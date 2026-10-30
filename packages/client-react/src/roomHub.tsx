// アプリ全体で1つの RoomHub(ルームの接続をまとめて持つ。client-core の roomHub.ts)。
// 音声をつないだルームは、画面を移ってもつないだままにするため、ログインした後のレイアウトで持つ。
// 端末に依るところ(音声の出し方、画面の見え方、画面を消させない)は各アプリから渡す
import {
  type AppPresence,
  RoomHub,
  type RoomPlatform,
  RoomSession,
  type ScreenAwake,
  type User,
} from "@voice-intercom/client-core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { useApi } from "./api.tsx";
import { useObservable } from "./useObservable.ts";

// 履歴の1ページの件数
export const PAGE_LIMIT = 50;

const RoomHubContext = createContext<RoomHub | undefined>(undefined);

export interface RoomHubProviderProps {
  me: User;
  myIdentity: string;
  // 次の3つは、描き直しのたびにつなぎ直さないよう、モジュールの定数を渡す
  platform: RoomPlatform;
  presence: AppPresence;
  createAwake: () => ScreenAwake;
  children: ReactNode;
}

export function RoomHubProvider({ me, myIdentity, platform, presence, createAwake, children }: RoomHubProviderProps) {
  const api = useApi();
  const [hub, setHub] = useState<RoomHub>();

  // 言語を変えたら、受け取る翻訳が変わるので、つなぎ直す
  useEffect(() => {
    const h = new RoomHub({
      createSession: (seed) =>
        new RoomSession({
          ...seed,
          myIdentity,
          myLanguage: me.language,
          platform,
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
      presence,
      awake: createAwake(),
    });
    setHub(h);
    return () => h.dispose();
  }, [api, myIdentity, me.language, platform, presence, createAwake]);

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

// PTT のキーの文言と状態(音声をつないだ全部のルームに届く)。2つ以上つないでいるときは、全部に届くことを文言で示す
export function mainPttState(hub: RoomHub): { state: "idle" | "pressing" | "talking"; label: string; connected: boolean } {
  const rooms = hub.audioRooms;
  const talking = rooms.some((r) => r.session.talking);
  const pressing = hub.pressingAny;
  const target = rooms.length > 1 ? `(${rooms.length}ルーム)` : "";
  return {
    state: talking ? "talking" : pressing ? "pressing" : "idle",
    label: talking ? `送話中${target}` : pressing ? "マイクを準備中…" : `押して話す${target}`,
    connected: rooms.some((r) => r.session.connected),
  };
}
