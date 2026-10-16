import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { TimelineEvent } from "../api.ts";
import { deletionFor, flush, ownText, tombstoneOf } from "../testing/fixtures.ts";
import { DeletionReceiver } from "./deletionReceiver.ts";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

test("履歴で消されていれば墓石を渡し、送信元の参加者があるものは捨てる", async () => {
  const row = ownText("2026-10-13T00:00:01.000Z");
  const confirmed: TimelineEvent[] = [];
  const receiver = new DeletionReceiver({
    fetchEvent: async () => tombstoneOf(row),
    onConfirmed: (r) => confirmed.push(r),
    isApplied: () => false,
  });

  expect(receiver.receive(deletionFor(row), true)).toBe("fromParticipant");
  expect(receiver.receive(deletionFor(row), false)).toBe("checking");
  expect(receiver.receive(deletionFor(row), false)).toBe("duplicate");
  await flush();

  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]!.deleted).not.toBeNull();
  expect(receiver.pendingCount).toBe(0);
});

test("偽の知らせ(履歴では消されていない、行が無い)は捨てる", async () => {
  const row = ownText("2026-10-13T00:00:01.000Z");
  const confirmed: TimelineEvent[] = [];
  const receiver = new DeletionReceiver({
    fetchEvent: async (id) => (id === row.event_id ? row : null),
    onConfirmed: (r) => confirmed.push(r),
    isApplied: () => false,
  });

  receiver.receive(deletionFor(row), false);
  receiver.receive(deletionFor(ownText("2026-10-13T00:00:02.000Z", { sourceId: "x" })), false);
  await flush();

  expect(confirmed).toEqual([]);
});

test("読めなければ間を置いて読み直す", async () => {
  const row = ownText("2026-10-13T00:00:01.000Z");
  let calls = 0;
  const confirmed: TimelineEvent[] = [];
  const receiver = new DeletionReceiver({
    fetchEvent: async () => {
      calls++;
      if (calls === 1) {
        throw new Error("通信の失敗");
      }
      return tombstoneOf(row);
    },
    onConfirmed: (r) => confirmed.push(r),
    isApplied: () => false,
    retryDelaysMs: [10],
  });

  receiver.receive(deletionFor(row), false);
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(calls).toBe(2);
  expect(confirmed).toHaveLength(1);
  receiver.dispose();
});

test("読めないもの、event_id が空のものは捨てる", () => {
  const receiver = new DeletionReceiver({
    fetchEvent: async () => null,
    onConfirmed: () => {},
    isApplied: () => false,
  });
  expect(receiver.receive(Uint8Array.from([0xff, 0xff]), false)).toBe("invalid");
  expect(receiver.receive(new Uint8Array(0), false)).toBe("invalid");
});
