// 読み上げの待ち行列と、次の区切りの速さの決め方。DOM を使わない(Vitest で試す)。
//
// 設計メモの「案 C を却下した理由の見直し」の案のとおり:
// - 待ち行列はアプリで持ち、TTS には1区切りずつ渡す(渡した後の速さは変えられないため)。
// - 前の区切りを読み終えた時点(何も読んでいなければ、届いた時点)の待ちの量で、次の速さを決める。
// - 待ちの量は、待ち行列にある区切り(次に渡すものを含む)の文字数から見積もった、1.0倍で読む秒数の合計。
// - 届いてから一定より待った区切りは飛ばす(既定は飛ばさない)。

import type { LangCode } from "./languages.ts";

/** 字幕の1区切り(翻訳後のテキスト) */
export interface Segment {
  id: string;
  text: string;
  lang: LangCode;
  /** 届いた時刻(ミリ秒) */
  arrivedAt: number;
}

export interface PacingPolicy {
  /** 待ちが少ないときの速さ */
  minRate: number;
  /** 待ちが多いときの速さの上限 */
  maxRate: number;
  /** 待ちがこの秒数以下なら minRate */
  lowBacklogSec: number;
  /** 待ちがこの秒数以上なら maxRate。間は直線で上げる */
  highBacklogSec: number;
  /** 速さの刻み(0.05 なら 1.00、1.05、…) */
  rateStep: number;
  /** 届いてからこの秒数を超えて待った区切りは読まずに飛ばす。0 なら飛ばさない */
  dropAfterSec: number;
}

export const DEFAULT_POLICY: PacingPolicy = {
  minRate: 1.0,
  maxRate: 1.5,
  lowBacklogSec: 4,
  highBacklogSec: 12,
  rateStep: 0.05,
  dropAfterSec: 0,
};

// 文字数を数えるときに空白を数えない言語(語の間に空白を置かない、または音節の文字の言語)
const NO_SPACE_LANGS: ReadonlySet<LangCode> = new Set(["ja", "zh", "ko"]);

/**
 * 1.0倍で1秒に読む文字数の初期値。ページで声ごとに実測して置き換える。
 * Mac の Chrome での実測(2026-10-23、長めの文。macOS の声と Google の声の間を 0.5 刻みで丸めた)。
 * ja・zh・ko は空白を除いた文字数、ほかは空白を1つにまとめた文字数で数える。
 */
export const DEFAULT_CHARS_PER_SEC: Record<LangCode, number> = {
  es: 15.5,
  pt: 11.5,
  fr: 16,
  ja: 5,
  ru: 12,
  zh: 4,
  de: 12.5,
  ko: 5.5,
  hi: 13,
  id: 11.5,
  vi: 11,
  it: 14.5,
  en: 15.5,
};

/** 読み上げの長さを見積もるための文字数(コードポイントで数える) */
export function countChars(text: string, lang: LangCode): number {
  const t = NO_SPACE_LANGS.has(lang) ? text.replace(/\s+/gu, "") : text.trim().replace(/\s+/gu, " ");
  return Array.from(t).length;
}

/** 速さ `rate` で読む秒数の見積もり */
export function estimateSeconds(text: string, lang: LangCode, charsPerSec: number, rate = 1): number {
  if (charsPerSec <= 0 || rate <= 0) return 0;
  return countChars(text, lang) / (charsPerSec * rate);
}

/** 実際に読んだ秒数から、1.0倍に直した1秒あたりの文字数を出す */
export function observedCharsPerSec(text: string, lang: LangCode, seconds: number, rate: number): number | null {
  if (seconds <= 0 || rate <= 0) return null;
  return countChars(text, lang) / (seconds * rate);
}

function roundTo(value: number, step: number): number {
  const r = step > 0 ? Math.round(value / step) * step : value;
  // 0.1 + 0.2 のような誤差を落とす
  return Number(r.toFixed(4));
}

/** 待ちの量(秒)から次の速さを決める */
export function chooseRate(backlogSec: number, policy: PacingPolicy): number {
  const { minRate, maxRate, lowBacklogSec, highBacklogSec, rateStep } = policy;
  if (backlogSec <= lowBacklogSec) return minRate;
  if (backlogSec >= highBacklogSec || highBacklogSec <= lowBacklogSec) return maxRate;
  const frac = (backlogSec - lowBacklogSec) / (highBacklogSec - lowBacklogSec);
  const rate = roundTo(minRate + frac * (maxRate - minRate), rateStep);
  return Math.min(maxRate, Math.max(minRate, rate));
}

/** 次に TTS に渡す区切りと、そのときの判断 */
export interface Decision {
  segment: Segment;
  rate: number;
  /** 判断した時点の待ちの量(1.0倍で読む秒数。渡す区切りを含む) */
  backlogSec: number;
  /** 判断した時点に待ち行列にあった区切りの数(渡す区切りを含む) */
  queued: number;
  decidedAt: number;
}

/**
 * 読み上げの待ち行列。時計もタイマーも持たず、呼び出し側が時刻を渡す。
 * `estimate` は区切りを1.0倍で読む秒数の見積もり。
 */
export class PacingQueue {
  private items: Segment[] = [];

  constructor(
    private readonly policy: PacingPolicy,
    private readonly estimate: (segment: Segment) => number,
  ) {}

  enqueue(segment: Segment): void {
    this.items.push(segment);
  }

  get size(): number {
    return this.items.length;
  }

  /** 待ち行列にある区切りを1.0倍で読む秒数の合計 */
  backlogSec(): number {
    return this.items.reduce((sum, s) => sum + this.estimate(s), 0);
  }

  /**
   * 次に渡す区切りを取り出し、速さを決める。待ちすぎた区切りは先に飛ばす。
   * 渡すものがなければ `next` は null。
   */
  takeNext(now: number): { next: Decision | null; dropped: Segment[] } {
    const dropped: Segment[] = [];
    if (this.policy.dropAfterSec > 0) {
      const limitMs = this.policy.dropAfterSec * 1000;
      this.items = this.items.filter((s) => {
        const tooOld = now - s.arrivedAt > limitMs;
        if (tooOld) dropped.push(s);
        return !tooOld;
      });
    }
    const segment = this.items[0];
    if (!segment) return { next: null, dropped };
    const backlogSec = this.backlogSec();
    const queued = this.items.length;
    this.items.shift();
    return {
      next: { segment, rate: chooseRate(backlogSec, this.policy), backlogSec, queued, decidedAt: now },
      dropped,
    };
  }
}

/**
 * 長い発話の字幕が数秒ごとに届くのを模擬する。
 * 最初の区切りは `firstDelaySec` 後に届き、そのあとは `intervalSec(i, text)` 秒ごとに届く。
 */
export function buildFeed(
  texts: readonly string[],
  lang: LangCode,
  startMs: number,
  firstDelaySec: number,
  intervalSec: (index: number, text: string) => number,
): Segment[] {
  let at = startMs + firstDelaySec * 1000;
  return texts.map((text, i) => {
    if (i > 0) at += intervalSec(i, text) * 1000;
    return { id: `s${i + 1}`, text, lang, arrivedAt: at };
  });
}

/** 区切りごとの結果(模擬と、ページでの実際の読み上げで同じ形にする) */
export interface SegmentResult {
  id: string;
  text: string;
  arrivedAt: number;
  dropped: boolean;
  rate?: number;
  backlogSec?: number;
  queued?: number;
  /** TTS に渡した時刻 */
  speakAt?: number;
  /** 読み始め(start イベント)の時刻 */
  startAt?: number;
  /** 読み終え(end イベント)の時刻 */
  endAt?: number;
}

/**
 * 声を使わずに、待ち行列の振る舞いを模擬する。
 * `speakSeconds(segment, rate)` は、その速さで実際に読む秒数(テストでは見積もりと同じ式を使う)。
 */
export function simulate(
  feed: readonly Segment[],
  policy: PacingPolicy,
  estimate: (segment: Segment) => number,
  speakSeconds: (segment: Segment, rate: number) => number,
): SegmentResult[] {
  const arrivals = [...feed].sort((a, b) => a.arrivedAt - b.arrivedAt);
  const queue = new PacingQueue(policy, estimate);
  const results = new Map<string, SegmentResult>(
    arrivals.map((s) => [s.id, { id: s.id, text: s.text, arrivedAt: s.arrivedAt, dropped: false }]),
  );
  let now = arrivals[0]?.arrivedAt ?? 0;
  let i = 0;
  const admit = () => {
    while (i < arrivals.length && (arrivals[i]?.arrivedAt ?? Infinity) <= now) {
      queue.enqueue(arrivals[i] as Segment);
      i += 1;
    }
  };
  while (i < arrivals.length || queue.size > 0) {
    if (queue.size === 0) now = Math.max(now, arrivals[i]?.arrivedAt ?? now);
    admit();
    const { next, dropped } = queue.takeNext(now);
    for (const d of dropped) {
      const r = results.get(d.id);
      if (r) r.dropped = true;
    }
    if (!next) continue;
    const ms = speakSeconds(next.segment, next.rate) * 1000;
    const r = results.get(next.segment.id);
    if (r) {
      Object.assign(r, {
        rate: next.rate,
        backlogSec: next.backlogSec,
        queued: next.queued,
        speakAt: now,
        startAt: now,
        endAt: now + ms,
      });
    }
    now += ms;
  }
  return arrivals.map((s) => results.get(s.id) as SegmentResult);
}

export interface RunSummary {
  spoken: number;
  dropped: number;
  /** 届いてから読み終えるまでの最大(秒) */
  maxLagSec: number | null;
  /** 最後に読んだ区切りの、届いてから読み終えるまで(秒)。発話の終わりからの遅れに近い */
  lastLagSec: number | null;
  /** 届いてから読み始めるまでの最大(秒) */
  maxWaitSec: number | null;
  meanRate: number | null;
}

/** 結果をまとめる。読み終えていない区切りは数えない */
export function summarize(results: readonly SegmentResult[]): RunSummary {
  const done = results.filter((r) => !r.dropped && r.endAt !== undefined);
  const lags = done.map((r) => ((r.endAt as number) - r.arrivedAt) / 1000);
  const waits = done
    .filter((r) => r.startAt !== undefined)
    .map((r) => ((r.startAt as number) - r.arrivedAt) / 1000);
  const rates = done.flatMap((r) => (r.rate === undefined ? [] : [r.rate]));
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  return {
    spoken: done.length,
    dropped: results.filter((r) => r.dropped).length,
    maxLagSec: max(lags),
    lastLagSec: lags.length ? (lags[lags.length - 1] as number) : null,
    maxWaitSec: max(waits),
    meanRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
  };
}
