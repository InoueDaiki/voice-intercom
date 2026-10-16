import { create, toBinary } from "@bufbuild/protobuf";
import { MediaMessageSchema } from "@voice-intercom/schema/voiceintercom/v1/media_pb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { TimelineEvent } from "../api.ts";
import { mediaEvent, messageFor, textEvent } from "../testing/fixtures.ts";
import { MediaFeed } from "./mediaFeed.ts";
import { MediaReceiver } from "./mediaReceiver.ts";

// 履歴の代わり。rows を返し、呼ばれた回数を数える
class FakeTimeline {
  rows: TimelineEvent[] = [];
  calls = 0;
  gate: Promise<void> | undefined;
  error: Error | undefined;

  readonly fetch = async (): Promise<TimelineEvent[]> => {
    this.calls++;
    if (this.gate) {
      await this.gate;
    }
    if (this.error) {
      throw this.error;
    }
    return [...this.rows];
  };
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

let timeline: FakeTimeline;
let feed: MediaFeed;
let receiver: MediaReceiver;

const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  timeline = new FakeTimeline();
  feed = new MediaFeed();
  receiver = new MediaReceiver({
    fetchRecent: timeline.fetch,
    onConfirmed: (e) => feed.addAll(e),
    isKnown: (id) => feed.contains(id),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("送信元の参加者があるものは、履歴を読まずに捨てる", async () => {
  const row = mediaEvent("2026-10-13T00:00:01.000Z");
  timeline.rows = [row];
  expect(receiver.receive(messageFor(row), true)).toBe("fromParticipant");
  await elapse(0);
  expect(timeline.calls).toBe(0);
  expect(feed.items).toEqual([]);
});

test("履歴に行があれば、履歴の行を出す", async () => {
  const row = mediaEvent("2026-10-13T00:00:01.000Z", {
    senderId: "bob",
    video: true,
    width: 720,
    height: 1280,
    durationMs: 15500,
  });
  timeline.rows = [textEvent("2026-10-13T00:00:02.000Z"), row];
  expect(receiver.receive(messageFor(row), false)).toBe("checking");
  await elapse(0);
  expect(timeline.calls).toBe(1);
  expect(feed.items).toHaveLength(1);
  // 幅・高さ・長さも履歴の行のもの
  expect(feed.items[0]!.media!.width).toBe(720);
  expect(feed.items[0]!.media!.duration_ms).toBe(15500);
  expect(feed.items[0]!.sender_id).toBe("bob");
  expect(receiver.pendingCount).toBe(0);
});

test("中身は履歴の行で置き換える(偽った URL や送信者は出さない)", async () => {
  const row = mediaEvent("2026-10-13T00:00:01.000Z", { senderId: "bob" });
  timeline.rows = [row];
  receiver.receive(messageFor(row, { url: "https://evil.example/x.jpg", senderIdentity: "carol" }), false);
  await elapse(0);
  expect(feed.items[0]!.media!.url).toBe(row.media!.url);
  expect(feed.items[0]!.sender_id).toBe("bob");
});

test("履歴に無ければ読み直し、それでも無ければ捨てる", async () => {
  const row = mediaEvent("2026-10-13T00:00:01.000Z");
  receiver.receive(messageFor(row), false);
  await elapse(0);
  expect(timeline.calls).toBe(1);
  await elapse(1000);
  expect(timeline.calls).toBe(2);
  await elapse(3000);
  expect(timeline.calls).toBe(3);
  await elapse(10_000);
  expect(timeline.calls).toBe(3);
  expect(feed.items).toEqual([]);
  expect(receiver.pendingCount).toBe(0);
});

test("保存の直後に見えなくても、読み直しで見つかれば出す(結果整合)", async () => {
  const row = mediaEvent("2026-10-13T00:00:01.000Z");
  receiver.receive(messageFor(row), false);
  await elapse(0);
  expect(feed.items).toEqual([]);
  timeline.rows = [row];
  await elapse(1000);
  expect(feed.items).toHaveLength(1);
  await elapse(10_000);
  expect(timeline.calls).toBe(2);
});

test("履歴を読めなければ、読み直す", async () => {
  const row = mediaEvent("2026-10-13T00:00:01.000Z");
  timeline.rows = [row];
  timeline.error = new Error("503");
  receiver.receive(messageFor(row), false);
  await elapse(0);
  expect(feed.items).toEqual([]);
  timeline.error = undefined;
  await elapse(1000);
  expect(feed.items).toHaveLength(1);
});

test("同じ event_id は重ねない(表示済み、確かめ中、complete のやり直し)", async () => {
  const mine = mediaEvent("2026-10-13T00:00:01.000Z", { sourceId: "mine" });
  const other = mediaEvent("2026-10-13T00:00:02.000Z", { sourceId: "other" });
  timeline.rows = [other, mine];
  // 自分の送信は complete の応答で出してある
  feed.add(mine);
  expect(receiver.receive(messageFor(mine), false)).toBe("duplicate");
  const g = gate();
  timeline.gate = g.promise;
  expect(receiver.receive(messageFor(other), false)).toBe("checking");
  expect(receiver.receive(messageFor(other), false)).toBe("duplicate");
  g.open();
  await elapse(0);
  expect(receiver.receive(messageFor(other), false)).toBe("duplicate");
  expect(timeline.calls).toBe(1);
  expect(feed.items).toHaveLength(2);
});

test("読んでいる間に届いたものは、読み終えてから1回でまとめて確かめる", async () => {
  const rows = [0, 1, 2, 3, 4].map((i) => mediaEvent(`2026-10-13T00:00:0${i}.000Z`, { sourceId: `m${i}` }));
  timeline.rows = rows;
  const g = gate();
  timeline.gate = g.promise;
  for (const r of rows) {
    receiver.receive(messageFor(r), false);
  }
  expect(timeline.calls).toBe(1);
  g.open();
  timeline.gate = undefined;
  await elapse(0);
  expect(timeline.calls).toBe(2);
  expect(feed.items).toHaveLength(5);
});

test("読めないもの、event_id の空のものは捨てる", () => {
  expect(receiver.receive(Uint8Array.from([0xff, 0xff, 0xff]), false)).toBe("invalid");
  expect(receiver.receive(toBinary(MediaMessageSchema, create(MediaMessageSchema)), false)).toBe("invalid");
});

test("確かめ待ちが上限を超えたら捨てる", async () => {
  receiver = new MediaReceiver({
    fetchRecent: timeline.fetch,
    onConfirmed: (e) => feed.addAll(e),
    isKnown: (id) => feed.contains(id),
    maxPending: 2,
  });
  const g = gate();
  timeline.gate = g.promise;
  const results = [0, 1, 2].map((i) =>
    receiver.receive(messageFor(mediaEvent(`2026-10-13T00:00:0${i}.000Z`, { sourceId: `m${i}` })), false),
  );
  expect(results.at(-1)).toBe("overflow");
  receiver.dispose();
  g.open();
  await elapse(0);
  expect(feed.items).toEqual([]);
});

test("dispose の後は読み直さない", async () => {
  receiver.receive(messageFor(mediaEvent("2026-10-13T00:00:01.000Z")), false);
  await elapse(0);
  receiver.dispose();
  await elapse(10_000);
  expect(timeline.calls).toBe(1);
});
