// OS とのやり取りを包むネイティブのモジュール(ios/Core が本体、ios/Binding がつなぐ層)の JS 側。
// iOS では Push to Talk の仕組み(PTChannelManager)を使う。モジュールが無い環境(Android、Web)では
// pttChannel が undefined になるので、呼ぶ側で分岐する。

import { type EventSubscription, requireOptionalNativeModule } from "expo";

export type PttServiceStatus = "ready" | "connecting" | "unavailable";
export type PttTransmissionMode = "fullDuplex" | "halfDuplex" | "listenOnly";
export type PttTransmitSource = "userRequest" | "developerRequest" | "handsfreeButton" | "unknown";

// atMs はネイティブで起きた時刻(UNIX 時間のミリ秒)。JS が起動する前に起きたものも、
// 起動の後にまとめて届く(届いた時刻ではなく、起きた時刻を見る)
type Base<T extends string, F = object> = { type: T; atMs: number } & F;

export type PttEvent =
  | Base<"ready", { activeChannelId?: string }>
  | Base<"joined", { channelId: string; reason: "developerRequest" | "channelRestoration" | "unknown" }>
  | Base<"left", { channelId: string; reason: "userRequest" | "developerRequest" | "systemPolicy" | "unknown" }>
  | Base<"transmissionBegan", { channelId: string; source: PttTransmitSource }>
  | Base<"transmissionEnded", { channelId: string; source: PttTransmitSource }>
  | Base<"pushToken", { token: string }>
  | Base<"incomingPush", { channelId: string; payload: Record<string, unknown> }>
  | Base<"audioActivated">
  | Base<"audioDeactivated">
  | Base<"error", { operation: string; message: string; channelId?: string }>;

interface NativeModule {
  join(channelId: string, name: string): Promise<void>;
  leave(): Promise<void>;
  beginTransmitting(): Promise<void>;
  stopTransmitting(): Promise<void>;
  setActiveRemoteParticipant(name: string | null): Promise<void>;
  setServiceStatus(status: PttServiceStatus): Promise<void>;
  setTransmissionMode(mode: PttTransmissionMode): Promise<void>;
  getActiveChannelId(): Promise<string | null>;
  addListener(eventName: "onPttEvent", listener: (event: PttEvent) => void): EventSubscription;
}

const native = requireOptionalNativeModule<NativeModule>("IntercomOs");

export interface PttChannel {
  // 前面にいるときにだけ参加できる。channelId は UUID(ルームごとに決めて、アプリが覚えておく)
  join(channelId: string, name: string): Promise<void>;
  leave(): Promise<void>;
  // アプリの画面から話し始める・やめる。システムの画面から話すときは呼ばずに transmissionBegan が来る
  beginTransmitting(): Promise<void>;
  stopTransmitting(): Promise<void>;
  // 相手が話し始めたら名前を、話し終えたら null を渡す。システムが音声セッションを有効・無効にする
  setActiveRemoteParticipant(name: string | null): Promise<void>;
  setServiceStatus(status: PttServiceStatus): Promise<void>;
  setTransmissionMode(mode: PttTransmissionMode): Promise<void>;
  getActiveChannelId(): Promise<string | null>;
  // 付けたときに、JS が起動する前に起きた出来事もまとめて届く。付けるのはアプリで1か所にする
  // (最初に付けた listener が、貯まっていた出来事を受け取る)
  addListener(listener: (event: PttEvent) => void): () => void;
}

export const pttChannel: PttChannel | undefined = native ? createPttChannel(native) : undefined;

function createPttChannel(native: NativeModule): PttChannel {
  return {
    join: (channelId, name) => native.join(channelId, name),
    leave: () => native.leave(),
    beginTransmitting: () => native.beginTransmitting(),
    stopTransmitting: () => native.stopTransmitting(),
    setActiveRemoteParticipant: (name) => native.setActiveRemoteParticipant(name),
    setServiceStatus: (status) => native.setServiceStatus(status),
    setTransmissionMode: (mode) => native.setTransmissionMode(mode),
    getActiveChannelId: () => native.getActiveChannelId(),
    addListener: (listener) => {
      const subscription = native.addListener("onPttEvent", listener);
      return () => subscription.remove();
    },
  };
}
