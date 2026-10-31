import { describe, expect, test, vi } from "vitest";

import type { TimelineEvent, TimelinePage } from "../api.ts";
import { caption, flush, mediaEvent, ownText, textEvent, tombstoneOf } from "../testing/fixtures.ts";
import { CaptionBoard } from "./captionBoard.ts";
import { RoomTimeline, type TimelineEntry } from "./roomTimeline.ts";

// 履歴の代わり。rows は新しい順に並べ、limit 件ずつ before より古いものを返す
class FakeHistory {
  rows: TimelineEvent[] = [];
  calls: (string | undefined)[] = [];
  constructor(private readonly limit = 2) {}

  readonly fetchPage = async (before: string | undefined): Promise<TimelinePage> => {
    this.calls.push(before);
    const sorted = [...this.rows].sort((a, b) => (a.event_id < b.event_id ? 1 : -1));
    const older = before === undefined ? sorted : sorted.filter((r) => r.event_id < before);
    const items = older.slice(0, this.limit);
    return { items, next_before: older.length > this.limit ? items.at(-1)!.event_id : null };
  };
}

function utterance(occurredAt: string, segmentId: string, text: string, translations = {}): TimelineEvent {
  return {
    room_id: "r1",
    event_id: `${occurredAt}#${segmentId}`,
    kind: "utterance",
    sender_id: "bob",
    occurred_at: occurredAt,
    language: "en",
    text,
    translations,
    utterance_id: "u1",
    segment_index: 0,
    media: null,
  };
}

// 行は source_id、字幕は segment_id で並びを見る
function keys(entries: TimelineEntry[]): string[] {
  return entries.map((e) =>
    e.type === "media" ? e.event.media!.media_id : e.event ? e.event.event_id.split("#")[1]! : e.key,
  );
}

function make(history: FakeHistory) {
  const changed = vi.fn();
  return { timeline: new RoomTimeline({ fetchPage: history.fetchPage, onChanged: changed }), changed };
}

describe("行の持ち方", () => {
  test("event_id で重ねず、時刻の順に並べる", () => {
    const { timeline } = make(new FakeHistory());
    expect(timeline.add(mediaEvent("2026-10-13T00:00:02.000Z", { sourceId: "b" }))).toBe(true);
    expect(timeline.add(mediaEvent("2026-10-13T00:00:01.000Z", { sourceId: "a" }))).toBe(true);
    // complete の応答と、後から読む履歴(や MediaMessage)が同じ行を持ってくる
    expect(timeline.add(mediaEvent("2026-10-13T00:00:02.000Z", { sourceId: "b" }))).toBe(false);
    expect(timeline.media.map((e) => e.media!.media_id)).toEqual(["a", "b"]);
  });

  test("墓石で置き換え、消していない行では戻さない", () => {
    const { timeline } = make(new FakeHistory());
    const row = mediaEvent("2026-10-13T00:00:01.000Z");
    timeline.add(row);
    expect(timeline.add(tombstoneOf(row))).toBe(true);
    expect(timeline.isDeleted(row.event_id)).toBe(true);
    // 遅れて届いた complete の応答や古い履歴で戻さない
    expect(timeline.add(row)).toBe(false);
    expect(timeline.isDeleted(row.event_id)).toBe(true);
  });

  test("知らない行の墓石も足す", () => {
    const { timeline } = make(new FakeHistory());
    expect(timeline.add(tombstoneOf(ownText("2026-10-13T00:00:01.000Z")))).toBe(true);
    expect(timeline.add(tombstoneOf(mediaEvent("2026-10-13T00:00:02.000Z")))).toBe(true);
  });
});

describe("字幕と履歴を1本にする", () => {
  test("履歴に同じ区切りの行があれば、字幕ではなく行を出す", () => {
    const { timeline } = make(new FakeHistory());
    const captions = new CaptionBoard({ now: () => new Date("2026-10-13T00:00:05.000Z") });
    captions.apply(caption("seg1", "hel", { language: "en", speaker: "bob" }));
    const live = timeline.entries(captions);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ type: "caption", key: "seg1", segment: expect.anything(), event: undefined });

    timeline.add(utterance("2026-10-13T00:00:04.000Z", "seg1", "hello", { ja: "こんにちは" }));
    const merged = timeline.entries(captions);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: "caption",
      key: "2026-10-13T00:00:04.000Z#seg1",
      segment: undefined,
      isText: false,
    });
    if (merged[0]!.type !== "caption") throw new Error();
    expect(merged[0]!.original).toEqual({ text: "hello", isFinal: true });
    expect(merged[0]!.translations.get("ja")).toEqual({ text: "こんにちは", isFinal: true });
  });

  test("テキスト・発話・画像を時刻の順に並べ、字幕は届いた時刻で入る", () => {
    const { timeline } = make(new FakeHistory());
    const captions = new CaptionBoard({ now: () => new Date("2026-10-13T00:00:03.500Z") });
    captions.apply(caption("live", "now", { speaker: "bob" }));
    timeline.addAll([
      utterance("2026-10-13T00:00:01.000Z", "u", "first"),
      mediaEvent("2026-10-13T00:00:03.000Z", { sourceId: "img" }),
      textEvent("2026-10-13T00:00:02.000Z", "t"),
      mediaEvent("2026-10-13T00:00:04.000Z", { sourceId: "later" }),
    ]);
    expect(keys(timeline.entries(captions))).toEqual(["u", "t", "img", "live", "later"]);
  });

  test("消した行は「削除された」ものとして本文を持たない", () => {
    const { timeline } = make(new FakeHistory());
    timeline.add(tombstoneOf(ownText("2026-10-13T00:00:01.000Z")));
    const [entry] = timeline.entries(new CaptionBoard());
    expect(entry).toMatchObject({ type: "caption", deleted: true, original: undefined, isText: true });
  });
});

describe("読み込み", () => {
  test("最初は最新のページだけを読み、上へ戻ると古いほうを読み足す", async () => {
    const history = new FakeHistory(2);
    history.rows = [1, 2, 3, 4, 5].map((i) => textEvent(`2026-10-13T00:00:0${i}.000Z`, `t${i}`));
    const { timeline } = make(history);
    expect(timeline.loaded).toBe(false);

    await timeline.syncLatest();
    expect(keys(timeline.entries(new CaptionBoard()))).toEqual(["t4", "t5"]);
    expect(timeline.hasOlder).toBe(true);

    await timeline.loadOlder();
    expect(keys(timeline.entries(new CaptionBoard()))).toEqual(["t2", "t3", "t4", "t5"]);
    await timeline.loadOlder();
    expect(keys(timeline.entries(new CaptionBoard()))).toEqual(["t1", "t2", "t3", "t4", "t5"]);
    expect(timeline.hasOlder).toBe(false);
    // もう無ければ読まない
    await timeline.loadOlder();
    expect(history.calls).toHaveLength(3);
  });

  test("読み足しを続けて呼んでも、1回しか読まない", async () => {
    const history = new FakeHistory(1);
    history.rows = [1, 2, 3].map((i) => textEvent(`2026-10-13T00:00:0${i}.000Z`, `t${i}`));
    const { timeline } = make(history);
    await timeline.syncLatest();
    await Promise.all([timeline.loadOlder(), timeline.loadOlder()]);
    expect(history.calls).toHaveLength(2);
  });

  test("つなぎ直しでは、持っている行のうち最も古いものに届くまで読む", async () => {
    const history = new FakeHistory(2);
    history.rows = [1, 2].map((i) => textEvent(`2026-10-13T00:00:0${i}.000Z`, `t${i}`));
    const { timeline } = make(history);
    await timeline.syncLatest();

    // 切れていた間に5件増えた
    history.rows.push(...[3, 4, 5, 6, 7].map((i) => textEvent(`2026-10-13T00:00:0${i}.000Z`, `t${i}`)));
    history.calls.length = 0;
    await timeline.syncLatest();

    expect(keys(timeline.entries(new CaptionBoard()))).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(history.calls).toHaveLength(4);
  });

  test("切断中に消された古い行も、つなぎ直しで墓石に替わる", async () => {
    const history = new FakeHistory(2);
    const old = ownText("2026-10-13T00:00:01.000Z", { sourceId: "old" });
    history.rows = [old, textEvent("2026-10-13T00:00:02.000Z", "t2"), textEvent("2026-10-13T00:00:03.000Z", "t3")];
    const { timeline } = make(history);
    await timeline.syncLatest();
    await timeline.loadOlder();
    expect(timeline.isDeleted(old.event_id)).toBe(false);

    // 1ページ目には載らない古い行が、切れていた間に消された
    history.rows[0] = tombstoneOf(old);
    await timeline.syncLatest();
    expect(timeline.isDeleted(old.event_id)).toBe(true);
  });

  test("読み足しに失敗したら止まり、やり直すと続きを読む", async () => {
    const history = new FakeHistory(1);
    history.rows = [1, 2].map((i) => textEvent(`2026-10-13T00:00:0${i}.000Z`, `t${i}`));
    const { timeline } = make(history);
    await timeline.syncLatest();

    const working = history.fetchPage;
    const failing = vi.fn(async () => {
      throw new Error("503");
    });
    (timeline as unknown as { fetchPage: unknown }).fetchPage = failing;
    await timeline.loadOlder();
    expect(timeline.olderFailed).toBe(true);
    expect(timeline.error).toContain("503");

    // 画面が何度呼んでも読みに行かない
    await timeline.loadOlder();
    await timeline.loadOlder();
    expect(failing).toHaveBeenCalledTimes(1);

    (timeline as unknown as { fetchPage: unknown }).fetchPage = working;
    await timeline.retryOlder();
    expect(timeline.olderFailed).toBe(false);
    expect(timeline.error).toBeUndefined();
    expect(keys(timeline.entries(new CaptionBoard()))).toEqual(["t1", "t2"]);
  });

  test("読めなければ error に入れ、行は変えない", async () => {
    const { timeline } = make(new FakeHistory());
    const failing = new RoomTimeline({
      fetchPage: async () => {
        throw new Error("503");
      },
      onChanged: () => {},
    });
    await failing.syncLatest();
    expect(failing.error).toContain("503");
    expect(failing.loaded).toBe(false);
    expect(timeline.error).toBeUndefined();
    await flush(1);
  });
});
