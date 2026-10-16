import { describe, expect, test } from "vitest";

import { mediaEvent, ownText, textEvent, tombstoneOf } from "../testing/fixtures.ts";
import { CaptionSegment } from "./captionBoard.ts";
import { MediaFeed, mergeRoomFeed } from "./mediaFeed.ts";

function segment(id: string, at: Date): CaptionSegment {
  return new CaptionSegment({
    segmentId: id,
    speakerIdentity: "bob",
    utteranceId: "",
    segmentIndex: 0,
    messageId: "",
    receivedAt: at,
  });
}

describe("MediaFeed", () => {
  test("event_id で重ねず、古い順に並べる", () => {
    const feed = new MediaFeed();
    expect(feed.add(mediaEvent("2026-10-13T00:00:02.000Z", { sourceId: "b" }))).toBe(true);
    expect(feed.add(mediaEvent("2026-10-13T00:00:01.000Z", { sourceId: "a" }))).toBe(true);
    // complete の応答と、後から読む履歴(や MediaMessage)が同じ行を持ってくる
    expect(feed.add(mediaEvent("2026-10-13T00:00:02.000Z", { sourceId: "b" }))).toBe(false);
    expect(feed.items.map((e) => e.media!.media_id)).toEqual(["a", "b"]);
  });

  test("画像・動画でない履歴の行は捨てる", () => {
    const feed = new MediaFeed();
    const added = feed.addAll([textEvent("2026-10-13T00:00:01.000Z"), mediaEvent("2026-10-13T00:00:02.000Z")]);
    expect(added).toBe(true);
    expect(feed.items).toHaveLength(1);
    expect(feed.addAll([textEvent("2026-10-13T00:00:03.000Z")])).toBe(false);
  });

  test("上限を超えたら古いものから捨てる", () => {
    const feed = new MediaFeed({ maxItems: 2 });
    feed.addAll([
      mediaEvent("2026-10-13T00:00:03.000Z", { sourceId: "c" }),
      mediaEvent("2026-10-13T00:00:01.000Z", { sourceId: "a" }),
      mediaEvent("2026-10-13T00:00:02.000Z", { sourceId: "b" }),
    ]);
    expect(feed.items.map((e) => e.media!.media_id)).toEqual(["b", "c"]);
    expect(feed.contains("2026-10-13T00:00:01.000Z#a")).toBe(false);
  });

  test("墓石で置き換え、消していない行では戻さない", () => {
    const feed = new MediaFeed();
    const row = mediaEvent("2026-10-13T00:00:01.000Z");
    feed.add(row);

    expect(feed.add(tombstoneOf(row))).toBe(true);
    expect(feed.isDeleted(row.event_id)).toBe(true);
    expect(feed.items[0]!.media).toBeNull();

    // 遅れて届いた complete の応答や古い履歴で戻さない
    expect(feed.add(row)).toBe(false);
    expect(feed.isDeleted(row.event_id)).toBe(true);
  });

  test("知らない行の墓石も足す(入室時の履歴)", () => {
    const feed = new MediaFeed();
    expect(feed.add(tombstoneOf(mediaEvent("2026-10-13T00:00:01.000Z")))).toBe(true);
    expect(feed.items).toHaveLength(1);
  });

  test("テキストの墓石は足さない", () => {
    const feed = new MediaFeed();
    expect(feed.add(tombstoneOf(ownText("2026-10-13T00:00:01.000Z")))).toBe(false);
  });
});

test("字幕と画像・動画を時刻の順に並べる", () => {
  const entries = mergeRoomFeed(
    [segment("s1", new Date(Date.UTC(2026, 9, 13, 0, 0, 1))), segment("s2", new Date(Date.UTC(2026, 9, 13, 0, 0, 3)))],
    [
      mediaEvent("2026-10-13T00:00:02.000Z", { sourceId: "m" }),
      // 入室より前の履歴
      mediaEvent("2026-10-12T23:00:00.000Z", { sourceId: "old" }),
    ],
  );
  expect(entries.map((e) => (e.type === "caption" ? e.segment.segmentId : e.event.media!.media_id))).toEqual([
    "old",
    "s1",
    "m",
    "s2",
  ]);
});
