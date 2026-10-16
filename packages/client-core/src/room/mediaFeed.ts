import type { TimelineEvent } from "../api.ts";
import type { CaptionSegment } from "./captionBoard.ts";

// ルームの画面に出す画像・動画。履歴の行(kind が media の TimelineEvent)の形で持ち、
// event_id で重ねない。
//
// 入れ口は3つ(設計メモの「アプリの表示と再生」):
// - 自分の送信: complete の応答(履歴の行)
// - 抜けを埋める: 入室とつなぎ直しのときに読む `GET /rooms/{room_id}/timeline`
// - ルームへの配信: データチャネル(topic `media`)の `MediaMessage`。`MediaReceiver` が
//   履歴で確かめ、履歴の行を渡す。
export class MediaFeed {
  // 持っておく件数の上限。古いものから捨てる(過去のものは履歴の画面で見る)
  readonly maxItems: number;
  private readonly itemMap = new Map<string, TimelineEvent>();

  constructor(options: { maxItems?: number } = {}) {
    this.maxItems = options.maxItems ?? 200;
  }

  // occurred_at の古い順
  get items(): TimelineEvent[] {
    return [...this.itemMap.values()].sort((a, b) => compare(a.event_id, b.event_id));
  }

  contains(eventId: string): boolean {
    return this.itemMap.has(eventId);
  }

  // 消した行(墓石)を表示しているか
  isDeleted(eventId: string): boolean {
    return this.itemMap.get(eventId)?.deleted != null;
  }

  // 足す。画像・動画でないものと、もうあるもの(同じ event_id)は捨てる。足したら true。
  //
  // 送った本人が消した行(墓石。`deleted` があり `media` が無い)も足し、もうある行は墓石で
  // 置き換える(「削除された画像・動画」をその場所に出す)。墓石を消していない行で戻すことはしない
  // (古い応答や遅れた complete の応答が後から届いても、消したものを戻さない)。
  add(event: TimelineEvent): boolean {
    if (event.kind !== "media") {
      return false;
    }
    const deleted = event.deleted != null;
    if (!deleted && event.media == null) {
      return false;
    }
    const current = this.itemMap.get(event.event_id);
    if (current && (current.deleted != null || !deleted)) {
      return false;
    }
    this.itemMap.set(event.event_id, event);
    if (this.itemMap.size > this.maxItems) {
      // event_id は `<occurred_at>#<source_id>` で、文字列の順が時刻の順になる
      const oldest = [...this.itemMap.keys()].reduce((a, b) => (compare(a, b) <= 0 ? a : b));
      this.itemMap.delete(oldest);
    }
    return true;
  }

  // まとめて足す。1件でも足したら true
  addAll(events: Iterable<TimelineEvent>): boolean {
    let added = false;
    for (const e of events) {
      added = this.add(e) || added;
    }
    return added;
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ルームの画面の時間の流れの1件。字幕か画像・動画。
export type RoomFeedEntry =
  | { type: "caption"; at: Date; segment: CaptionSegment }
  | { type: "media"; at: Date; event: TimelineEvent };

// 字幕と画像・動画を時刻の順(古い順)に並べる。字幕は届いた時刻、画像・動画は
// occurred_at(サーバーの時刻)なので、端末の時計がずれていれば前後しうる。
export function mergeRoomFeed(segments: CaptionSegment[], media: TimelineEvent[]): RoomFeedEntry[] {
  const entries: RoomFeedEntry[] = [
    ...segments.map((segment) => ({ type: "caption" as const, at: segment.receivedAt, segment })),
    ...media.map((event) => {
      const t = Date.parse(event.occurred_at);
      return { type: "media" as const, at: new Date(Number.isNaN(t) ? 0 : t), event };
    }),
  ];
  // 同じ時刻なら、元の並び(字幕は届いた順、画像・動画は event_id の順)を保つ(sort は安定)
  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}
