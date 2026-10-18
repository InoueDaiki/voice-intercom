import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  PacingQueue,
  buildFeed,
  chooseRate,
  countChars,
  estimateSeconds,
  observedCharsPerSec,
  simulate,
  summarize,
  type PacingPolicy,
  type Segment,
} from "./pacing.ts";

const seg = (id: string, text: string, arrivedAt: number): Segment => ({ id, text, lang: "en", arrivedAt });

describe("countChars", () => {
  it("日本語・中国語・韓国語は空白を数えない", () => {
    expect(countChars("田中さん、 14番 ゲート", "ja")).toBe(11);
    expect(countChars("다나카 씨", "ko")).toBe(4);
  });

  it("ほかの言語は空白を1つにまとめて数える", () => {
    expect(countChars("  Gate   14 ", "en")).toBe(7);
  });

  it("コードポイントで数える", () => {
    expect(countChars("𠮷野家", "ja")).toBe(3);
  });
});

describe("estimateSeconds と observedCharsPerSec", () => {
  it("速さに反比例する", () => {
    expect(estimateSeconds("a".repeat(28), "en", 14)).toBe(2);
    expect(estimateSeconds("a".repeat(28), "en", 14, 2)).toBe(1);
  });

  it("実測から1.0倍の文字数に直す", () => {
    expect(observedCharsPerSec("a".repeat(30), "en", 2, 1.5)).toBe(10);
    expect(observedCharsPerSec("abc", "en", 0, 1)).toBeNull();
  });
});

describe("chooseRate", () => {
  const p: PacingPolicy = { ...DEFAULT_POLICY, minRate: 1, maxRate: 1.5, lowBacklogSec: 4, highBacklogSec: 12 };

  it("待ちが少なければ最小、多ければ最大", () => {
    expect(chooseRate(0, p)).toBe(1);
    expect(chooseRate(4, p)).toBe(1);
    expect(chooseRate(12, p)).toBe(1.5);
    expect(chooseRate(60, p)).toBe(1.5);
  });

  it("間は直線で上げ、刻みに丸める", () => {
    expect(chooseRate(8, p)).toBe(1.25);
    expect(chooseRate(5, p)).toBe(1.05); // 1.0625 → 1.05
  });

  it("しきい値が逆なら、少ない側を超えたら最大にする", () => {
    expect(chooseRate(11, { ...p, lowBacklogSec: 10, highBacklogSec: 5 })).toBe(1.5);
  });
});

describe("PacingQueue", () => {
  // 1文字 = 1秒(1.0倍)
  const estimate = (s: Segment) => s.text.length;

  it("届いた順に1区切りずつ取り出し、渡す区切りを含めた待ちの量で速さを決める", () => {
    const q = new PacingQueue(DEFAULT_POLICY, estimate);
    q.enqueue(seg("a", "xxx", 0));
    q.enqueue(seg("b", "xxxxxxxxx", 0));
    const first = q.takeNext(0).next;
    expect(first?.segment.id).toBe("a");
    expect(first?.backlogSec).toBe(12);
    expect(first?.queued).toBe(2);
    expect(first?.rate).toBe(1.5);
    const second = q.takeNext(0).next;
    expect(second?.segment.id).toBe("b");
    expect(second?.backlogSec).toBe(9);
    expect(q.takeNext(0).next).toBeNull();
  });

  it("dropAfterSec を超えて待った区切りを飛ばす", () => {
    const q = new PacingQueue({ ...DEFAULT_POLICY, dropAfterSec: 5 }, estimate);
    q.enqueue(seg("old", "x", 0));
    q.enqueue(seg("new", "x", 4000));
    const { next, dropped } = q.takeNext(6000);
    expect(dropped.map((s) => s.id)).toEqual(["old"]);
    expect(next?.segment.id).toBe("new");
  });

  it("dropAfterSec が 0 なら飛ばさない", () => {
    const q = new PacingQueue(DEFAULT_POLICY, estimate);
    q.enqueue(seg("old", "x", 0));
    expect(q.takeNext(1_000_000).next?.segment.id).toBe("old");
  });
});

describe("buildFeed", () => {
  it("最初の区切りは firstDelaySec 後、あとは間隔ごとに届く", () => {
    const feed = buildFeed(["a", "b", "c"], "en", 1000, 6, () => 4);
    expect(feed.map((s) => s.arrivedAt)).toEqual([7000, 11000, 15000]);
    expect(feed.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
});

describe("simulate", () => {
  const estimate = (s: Segment) => s.text.length; // 1文字 = 1秒(1.0倍)
  const speak = (s: Segment, rate: number) => s.text.length / rate;

  it("間が空いていれば、届いてすぐ1.0倍で読む", () => {
    const feed = buildFeed(["xx", "xx"], "en", 0, 0, () => 10);
    const r = simulate(feed, DEFAULT_POLICY, estimate, speak);
    expect(r.map((x) => [x.startAt, x.endAt, x.rate])).toEqual([
      [0, 2000, 1],
      [10000, 12000, 1],
    ]);
    expect(summarize(r)).toMatchObject({ spoken: 2, dropped: 0, maxLagSec: 2, maxWaitSec: 0, meanRate: 1 });
  });

  it("前の区切りを読み終えた時点に届いていたものを待ちに数える", () => {
    // 5秒の区切りが2秒ごとに届く。1.0倍のままでは追いつかない
    const feed = buildFeed(["xxxxx", "xxxxx", "xxxxx", "xxxxx"], "en", 0, 0, () => 2);
    const policy: PacingPolicy = { ...DEFAULT_POLICY, lowBacklogSec: 5, highBacklogSec: 15 };
    const fixed = simulate(feed, { ...policy, maxRate: 1 }, estimate, speak);
    const paced = simulate(feed, policy, estimate, speak);
    expect(paced[0]?.rate).toBe(1);
    // 2つ目は1つ目を読み終えた5秒の時点で決まる。届いているのは s2・s3 で、待ちは10秒
    expect(paced[1]?.speakAt).toBe(5000);
    expect(paced[1]?.backlogSec).toBe(10);
    expect(paced[1]?.rate).toBe(1.25);
    const lagFixed = summarize(fixed).lastLagSec as number;
    const lagPaced = summarize(paced).lastLagSec as number;
    expect(lagFixed).toBe(14); // 20秒で読み終え、最後は6秒に届く
    expect(lagPaced).toBeLessThan(lagFixed);
  });

  it("待ちすぎた区切りを飛ばす", () => {
    const feed = buildFeed(["x".repeat(20), "x", "x"], "en", 0, 0, () => 1);
    const r = simulate(feed, { ...DEFAULT_POLICY, maxRate: 1, dropAfterSec: 10 }, estimate, speak);
    expect(r.map((x) => x.dropped)).toEqual([false, true, true]);
    expect(summarize(r)).toMatchObject({ spoken: 1, dropped: 2 });
  });

  it("空の入力では何も返さない", () => {
    expect(simulate([], DEFAULT_POLICY, estimate, speak)).toEqual([]);
    expect(summarize([])).toMatchObject({ spoken: 0, maxLagSec: null, meanRate: null });
  });
});
