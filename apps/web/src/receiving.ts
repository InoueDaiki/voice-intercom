import type { RoomSession, TimelineEntry } from "@voice-intercom/client-core";

export type CaptionEntry = Extract<TimelineEntry, { type: "caption" }>;

// ほかの人の声が流れているか。確定していない(話している途中の)音声の字幕のうち、最後のもの
export function receivingCaption(session: RoomSession, myIdentity: string): CaptionEntry | undefined {
  return session.entries.findLast(
    (e): e is CaptionEntry =>
      e.type === "caption" &&
      !e.isText &&
      e.speakerIdentity !== myIdentity &&
      e.original !== undefined &&
      !e.original.isFinal,
  );
}
