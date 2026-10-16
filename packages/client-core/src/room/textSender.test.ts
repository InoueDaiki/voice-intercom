import { create } from "@bufbuild/protobuf";
import type { TextMessage } from "@voice-intercom/schema/voiceintercom/v1/text_pb";
import {
  TextStatus_Reason,
  TextStatus_State,
  TextStatusSchema,
} from "@voice-intercom/schema/voiceintercom/v1/text_status_pb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { outgoingTextLabel, randomMessageId, TextSender } from "./textSender.ts";

let sent: TextMessage[];

function make(options: { failSend?: boolean; canSend?: () => boolean } = {}) {
  let n = 0;
  return new TextSender({
    canSend: options.canSend,
    send: async (m) => {
      sent.push(m);
      if (options.failSend) {
        throw new Error("送れない");
      }
    },
    onChanged: () => {},
    newMessageId: () => `m${++n}`,
  });
}

function status(
  state: TextStatus_State,
  options: { id?: string; reason?: TextStatus_Reason; maxChars?: number; untranslated?: string[]; unspoken?: string[] } = {},
) {
  return create(TextStatusSchema, {
    messageId: options.id ?? "m1",
    state,
    reason: options.reason,
    maxChars: options.maxChars ?? 0,
    untranslatedLanguages: options.untranslated ?? [],
    unspokenLanguages: options.unspoken ?? [],
  });
}

// 時間を進め、その間に待っている Promise の続きも流す
const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  sent = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("字幕が届けば送り直さない", async () => {
  const sender = make();
  const item = sender.submit("  はい  ")!;
  await elapse(0);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ messageId: "m1", text: "はい" });

  sender.acknowledge("m1");
  await elapse(20_000);
  expect(sent).toHaveLength(1);
  expect(item.state).toBe("delivered");
});

test("字幕が届かなければ同じ message_id で送り直し、上限で諦める", async () => {
  const sender = make();
  const item = sender.submit("はい")!;
  await elapse(4000);
  expect(sent.map((m) => m.messageId)).toEqual(["m1", "m1"]);
  expect(item.state).toBe("sending");

  await elapse(4000);
  expect(sent).toHaveLength(3);
  await elapse(4000);
  expect(sent).toHaveLength(3);
  expect(item.state).toBe("failed");
});

test("送り直した後に字幕が届けば、そこで止める", async () => {
  const sender = make();
  const item = sender.submit("はい")!;
  await elapse(5000);
  sender.acknowledge("m1");
  await elapse(20_000);
  expect(sent).toHaveLength(2);
  expect(item.state).toBe("delivered");
});

test("送信に失敗しても送り直す", async () => {
  const sender = make({ failSend: true });
  sender.submit("はい");
  await elapse(4000);
  expect(sent).toHaveLength(2);
});

test("送ってよくなるまで待ち、resume ですぐ送る", async () => {
  let agentKnown = false;
  const sender = make({ canSend: () => agentKnown });
  const item = sender.submit("はい")!;
  await elapse(3000);
  expect(sent).toEqual([]);
  expect(item.state).toBe("sending");

  // まだ送れないうちの resume は何もしない
  sender.resume();
  await elapse(0);
  expect(sent).toEqual([]);

  agentKnown = true;
  sender.resume();
  await elapse(0);
  expect(sent.map((m) => m.messageId)).toEqual(["m1"]);

  // 待ちの時間切れ(4秒)ではなく、送ったときから数え直す
  await elapse(3000);
  expect(sent).toHaveLength(1);
  sender.acknowledge("m1");
  await elapse(20_000);
  expect(sent).toHaveLength(1);
  expect(item.state).toBe("delivered");
});

test("送ってよくならないまま上限まで待てば諦める", async () => {
  const sender = make({ canSend: () => false });
  const item = sender.submit("はい")!;
  await elapse(12_000);
  expect(sent).toEqual([]);
  expect(item.state).toBe("failed");
});

test("待っている間の時間切れの後に送れるようになれば、次の回で送る", async () => {
  let agentKnown = false;
  const sender = make({ canSend: () => agentKnown });
  sender.submit("はい");
  await elapse(2000);
  agentKnown = true;
  // resume を呼ばなくても、時間切れの送り直しで送る
  await elapse(2000);
  expect(sent.map((m) => m.messageId)).toEqual(["m1"]);
});

test("空のテキストは送らない", async () => {
  const sender = make();
  expect(sender.submit("   ")).toBeUndefined();
  await elapse(0);
  expect(sent).toEqual([]);
});

test("知らない message_id の字幕は無視する", () => {
  const sender = make();
  sender.acknowledge("other");
  expect(sender.items).toEqual([]);
});

test("ACCEPTED で送り直しを止め、結果が届くまで「届いた」と出す", async () => {
  const sender = make();
  const item = sender.submit("はい")!;
  expect(outgoingTextLabel(item)).toBe("送信中(1回目)");
  sender.applyStatus(status(TextStatus_State.ACCEPTED));
  await elapse(20_000);
  expect(sent).toHaveLength(1);
  expect(item.state).toBe("delivered");
  expect(outgoingTextLabel(item)).toBe("届いた");
  // 字幕が届いても、結果が届くまでは出したまま
  sender.acknowledge("m1");
  expect(outgoingTextLabel(item)).toBe("届いた");

  sender.applyStatus(status(TextStatus_State.COMPLETED));
  expect(item.state).toBe("delivered");
  expect(outgoingTextLabel(item)).toBeUndefined();
});

test("TextStatus を送らない Agent では、字幕が届いたら表示から消す", () => {
  const sender = make();
  const item = sender.submit("はい")!;
  sender.acknowledge("m1");
  expect(outgoingTextLabel(item)).toBeUndefined();
});

test("断られたら送り直さず、理由を出す", async () => {
  const sender = make();
  const item = sender.submit("長い")!;
  sender.applyStatus(status(TextStatus_State.REJECTED, { reason: TextStatus_Reason.TOO_LONG, maxChars: 500 }));
  await elapse(20_000);
  expect(sent).toHaveLength(1);
  expect(item.state).toBe("rejected");
  expect(outgoingTextLabel(item)).toBe("断られた(長すぎる。500文字まで)");
  // 送り直しへの応答が遅れて届いても戻さない
  sender.acknowledge("m1");
  sender.applyStatus(status(TextStatus_State.ACCEPTED));
  expect(item.state).toBe("rejected");
});

test("翻訳や読み上げに失敗したら「失敗した」と言語を出す", () => {
  const sender = make();
  const item = sender.submit("はい")!;
  sender.applyStatus(status(TextStatus_State.ACCEPTED));
  sender.applyStatus(status(TextStatus_State.FAILED, { untranslated: ["ko"], unspoken: ["en", "ja"] }));
  expect(item.state).toBe("processingFailed");
  expect(outgoingTextLabel(item)).toBe("失敗した(訳せなかった: ko、読み上げられなかった: en, ja)");
  // 送り直しへの ACCEPTED が後から届いても戻さない
  sender.applyStatus(status(TextStatus_State.ACCEPTED));
  expect(item.state).toBe("processingFailed");
});

test("「届かなかった」の後に結果が届けば、それに直す", async () => {
  const sender = make();
  const item = sender.submit("はい")!;
  await elapse(12_000);
  expect(outgoingTextLabel(item)).toBe("届かなかった");
  sender.applyStatus(status(TextStatus_State.COMPLETED));
  expect(item.state).toBe("delivered");
  expect(outgoingTextLabel(item)).toBeUndefined();
});

test("知らない message_id の TextStatus は無視する", () => {
  const sender = make();
  const item = sender.submit("はい")!;
  sender.applyStatus(status(TextStatus_State.REJECTED, { id: "other" }));
  expect(item.state).toBe("sending");
});

test("message_id は 32 文字の hex", () => {
  expect(randomMessageId()).toMatch(/^[0-9a-f]{32}$/);
  expect(randomMessageId()).not.toBe(randomMessageId());
});
