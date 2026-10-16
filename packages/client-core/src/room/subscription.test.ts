import { expect, test } from "vitest";

import { shouldSubscribe } from "./subscription.ts";

function subscribe(options: { isAudio?: boolean; fromAgent?: boolean; isMicrophone?: boolean; trackName?: string } = {}) {
  return shouldSubscribe({
    isAudio: options.isAudio ?? true,
    fromAgent: options.fromAgent ?? false,
    isMicrophone: options.isMicrophone ?? true,
    trackName: options.trackName ?? "",
    myLanguage: "ja",
  });
}

test("話者のマイクのトラックを購読する", () => {
  expect(subscribe()).toBe(true);
  expect(subscribe({ isMicrophone: false })).toBe(false);
  expect(subscribe({ isAudio: false })).toBe(false);
});

test("Agent のトラックは自分の言語の翻訳音声だけ", () => {
  expect(subscribe({ fromAgent: true, isMicrophone: false, trackName: "translation-ja" })).toBe(true);
  expect(subscribe({ fromAgent: true, isMicrophone: false, trackName: "translation-en" })).toBe(false);
  expect(subscribe({ fromAgent: true, trackName: "mic" })).toBe(false);
});
