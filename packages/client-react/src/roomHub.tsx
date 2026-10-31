// アプリ全体で1つの RoomHub(ルームの接続をまとめて持つ。client-core の roomHub.ts)。
// 音声をつないだルームは、画面を移ってもつないだままにするため、ログインした後のレイアウトで持つ。
// 端末に依るところ(音声の出し方、画面の見え方、画面を消させない)は各アプリから渡す
import {
  type AppPresence,
  type RoomConnection,
  RoomHub,
  type RoomPlatform,
  RoomSession,
  type ScreenAwake,
  type User,
} from "@voice-intercom/client-core";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

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
  // 止まっていたログインが戻ったら知らせる(解除する関数を返す)。切れたルームに入り直す。モジュールの定数を渡す
  subscribeLoginRecovered?: (listener: () => void) => () => void;
  children: ReactNode;
}

export function RoomHubProvider({
  me,
  myIdentity,
  platform,
  presence,
  createAwake,
  subscribeLoginRecovered,
  children,
}: RoomHubProviderProps) {
  const api = useApi();
  const [hub, setHub] = useState<RoomHub>();
  // 作り直す前の RoomHub で音声をつないでいたルーム
  const carried = useRef<{ identity: string; rooms: Pick<RoomConnection, "roomId" | "roomName">[] }>(undefined);

  // 言語を変えたら、受け取る翻訳が変わるので、つなぎ直す。音声をつないでいたルームは、音声ごとつなぎ直す
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
    // 別の人に替わったときは引き継がない
    if (carried.current?.identity === myIdentity) {
      h.resumeAudio(carried.current.rooms);
    }
    carried.current = undefined;
    return () => {
      carried.current = {
        identity: myIdentity,
        rooms: h.audioRooms.map(({ roomId, roomName }) => ({ roomId, roomName })),
      };
      h.dispose();
    };
  }, [api, myIdentity, me.language, platform, presence, createAwake]);

  useEffect(() => hub && subscribeLoginRecovered?.(() => hub.rejoinAll()), [hub, subscribeLoginRecovered]);

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

// ルームの接続の状態。connecting は最初の入室の途中、rejoining は入り直しの途中、
// failed は切断された・入室できなかった後(keeper.canRejoin なら入り直せる)
export type ConnectionState = "connected" | "connecting" | "rejoining" | "failed";

export function connectionState({ session, keeper }: Pick<RoomConnection, "session" | "keeper">): ConnectionState {
  if (session.connected) {
    return "connected";
  }
  if (keeper.rejoining) {
    return "rejoining";
  }
  return keeper.joinError !== undefined || session.error !== undefined ? "failed" : "connecting";
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
