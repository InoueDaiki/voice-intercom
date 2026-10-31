import { describe, expect, test } from "vitest";

import { caption } from "../testing/fixtures.ts";
import { CAPTION_STALE_MS, CaptionBoard } from "./captionBoard.ts";

describe("CaptionBoard", () => {
  test("上限を超えて捨てた区切りを知らせる", () => {
    const evicted: string[] = [];
    const board = new CaptionBoard({ maxSegments: 2, onEvicted: (s) => evicted.push(s.segmentId) });
    for (const id of ["s1", "s2", "s3"]) {
      board.apply(caption(id, "はい", { isFinal: true }));
    }
    expect(evicted).toEqual(["s1"]);
    expect(board.segments.map((s) => s.segmentId)).toEqual(["s2", "s3"]);
  });

  test("続きが届かなくなった字幕は新しくないとみなす", () => {
    let now = new Date("2026-10-13T00:00:00.000Z");
    const board = new CaptionBoard({ now: () => now });
    board.apply(caption("s1", "こん"));
    const [segment] = board.segments;

    now = new Date(now.getTime() + CAPTION_STALE_MS - 1);
    expect(segment!.isFresh(now)).toBe(true);
    // 続きが届けば、最初から時間がたっていても新しい
    board.apply(caption("s1", "にちは"));
    now = new Date(now.getTime() + CAPTION_STALE_MS - 1);
    expect(segment!.isFresh(now)).toBe(true);

    now = new Date(now.getTime() + 1);
    expect(segment!.isFresh(now)).toBe(false);
  });

  test("断片を連結し、確定で置き換える", () => {
    const board = new CaptionBoard();
    board.apply(caption("s1", "こん"));
    board.apply(caption("s1", "にちは"));
    expect(board.segments[0]!.original).toEqual({ text: "こんにちは", isFinal: false });

    board.apply(caption("s1", "こんにちは。", { isFinal: true }));
    expect(board.segments[0]!.original).toEqual({ text: "こんにちは。", isFinal: true });
  });

  test("(segment_id, language, translated) ごとに分けて持つ", () => {
    const board = new CaptionBoard();
    board.apply(caption("s1", "はい", { isFinal: true }));
    board.apply(caption("s1", "Ye", { language: "en", translated: true }));
    board.apply(caption("s1", "s", { language: "en", translated: true }));
    board.apply(caption("s1", "네", { language: "ko", translated: true, isFinal: true }));

    const [s] = board.segments;
    expect(s!.originalLanguage).toBe("ja");
    expect(s!.original!.text).toBe("はい");
    expect(s!.translations.get("en")!.text).toBe("Yes");
    expect(s!.translations.get("ko")!.text).toBe("네");
  });

  test("確定の後に届いた断片は無視する", () => {
    const board = new CaptionBoard();
    board.apply(caption("s1", "確定", { isFinal: true }));
    board.apply(caption("s1", "遅れた断片"));
    expect(board.segments[0]!.original!.text).toBe("確定");
  });

  test("空の確定は字幕を消す", () => {
    const board = new CaptionBoard();
    board.apply(caption("s1", "えー"));
    board.apply(caption("s1", "", { isFinal: true }));
    expect(board.segments).toEqual([]);
  });

  test("区切りは届いた順に並び、上限を超えたら古いものから捨てる", () => {
    const board = new CaptionBoard({ maxSegments: 2 });
    board.apply(caption("s1", "1", { isFinal: true }));
    board.apply(caption("s2", "2", { isFinal: true }));
    board.apply(caption("s3", "3", { isFinal: true }));
    expect(board.segments.map((s) => s.segmentId)).toEqual(["s2", "s3"]);
  });

  test("テキスト入力の字幕は message_id を持つ", () => {
    const board = new CaptionBoard();
    board.apply(caption("s1", "はい", { isFinal: true, messageId: "m1" }));
    expect(board.segments[0]!.isText).toBe(true);
    expect(board.segments[0]!.messageId).toBe("m1");
  });
});

describe("消したテキスト", () => {
  const textCaption = (segmentId: string, text: string, o: { speaker?: string; language?: string; translated?: boolean } = {}) =>
    caption(segmentId, text, { speaker: o.speaker ?? "alice", messageId: "m1", isFinal: true, language: o.language, translated: o.translated });

  test("消したテキストは本文を捨て、後から届いた訳でも戻さない", () => {
    const board = new CaptionBoard();
    board.apply(textCaption("s1", "はい"));
    board.markTextDeleted("alice", "m1");

    const [segment] = board.segments;
    expect(segment!.deleted).toBe(true);
    expect(segment!.original).toBeUndefined();

    // 訳の途中だったものが後から届いても、本文は出さない
    board.apply(textCaption("s1", "Yes", { language: "en", translated: true }));
    expect(board.segments[0]!.translations.size).toBe(0);
  });

  test("Agent が送り直しに応えて送り直した字幕(RecentMessages)でも戻さない", () => {
    const board = new CaptionBoard();
    board.apply(textCaption("s1", "はい"));
    board.apply(textCaption("s1", "Yes", { language: "en", translated: true }));
    board.markTextDeleted("alice", "m1");

    // 同じ segment_id の原文と訳の確定が、もう一度届く
    board.apply(textCaption("s1", "はい"));
    board.apply(textCaption("s1", "Yes", { language: "en", translated: true }));

    const [segment] = board.segments;
    expect(segment!.deleted).toBe(true);
    expect(segment!.original).toBeUndefined();
    expect(segment!.translations.size).toBe(0);
  });

  test("消した後に初めて届いた字幕も、消したものとして出す", () => {
    const board = new CaptionBoard();
    board.markTextDeleted("alice", "m1");
    board.apply(textCaption("s1", "はい"));

    expect(board.segments[0]!.deleted).toBe(true);
    expect(board.segments[0]!.original).toBeUndefined();
  });

  test("送信者と message_id が両方合うものだけを消す", () => {
    const board = new CaptionBoard();
    board.apply(textCaption("s1", "はい", { speaker: "alice" }));
    board.apply(textCaption("s2", "うん", { speaker: "bob" }));
    board.markTextDeleted("bob", "m1");

    expect(board.segments.map((s) => [s.speakerIdentity, s.deleted])).toEqual([
      ["alice", false],
      ["bob", true],
    ]);
  });
});
