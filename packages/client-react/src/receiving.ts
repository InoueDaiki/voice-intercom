import type { RoomSession, TimelineEntry } from "@voice-intercom/client-core";

export type CaptionEntry = Extract<TimelineEntry, { type: "caption" }>;

// ほかの人の声が流れているか。確定していない(話している途中の)音声の字幕のうち、最後のもの。
// 確定が届かないまま続きも届かなくなったもの(Agent が落ちたなど)は除く
export function receivingCaption(session: RoomSession, myIdentity: string): CaptionEntry | undefined {
  return session.entries.findLast(
    (e): e is CaptionEntry =>
      e.type === "caption" &&
      !e.isText &&
      e.speakerIdentity !== myIdentity &&
      e.original !== undefined &&
      !e.original.isFinal &&
      e.segment?.isFresh() === true,
  );
}

// 通話の表示灯の状態(ui-web・ui-native の SignalState と同じ)
export type SignalState = "off" | "tx" | "rx";

// ルームでいま声が流れているか。自分が送っていれば TX、ほかの人が話していれば RX
export function signalOf(session: RoomSession, myIdentity: string): SignalState {
  if (session.talking) {
    return "tx";
  }
  return receivingCaption(session, myIdentity) ? "rx" : "off";
}
