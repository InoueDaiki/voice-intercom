import { create, toBinary } from "@bufbuild/protobuf";
import { CaptionSchema } from "@voice-intercom/schema/voiceintercom/v1/caption_pb";
import {
  TextStatus_Reason,
  TextStatus_State,
  TextStatusSchema,
} from "@voice-intercom/schema/voiceintercom/v1/text_status_pb";
import { ParticipantKind } from "livekit-client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TimelineEvent } from "../api.ts";
import {
  caption as textCaption,
  deletionFor,
  flush,
  mediaEvent,
  messageFor,
  ownText,
  tombstoneOf,
} from "../testing/fixtures.ts";
import { type DataSender, NotSavedYetError, RoomSession, type RoomSessionOptions } from "./roomSession.ts";
import { captionTopic, deletionTopic, mediaTopic, textStatusTopic } from "./topics.ts";

// 送信元の参加者(kind と identity だけを持つ)
const agent: DataSender = { kind: ParticipantKind.AGENT, identity: "agent-1" };
const mallory: DataSender = { kind: ParticipantKind.STANDARD, identity: "mallory" };

function captionData(options: { segmentId?: string; messageId?: string; speaker?: string } = {}): Uint8Array {
  return toBinary(
    CaptionSchema,
    create(CaptionSchema, {
      segmentId: options.segmentId ?? "s1",
      speakerIdentity: options.speaker ?? "bob",
      language: "en",
      text: "hello",
      isFinal: true,
      messageId: options.messageId ?? "",
    }),
  );
}

const sessions: RoomSession[] = [];
function newSession(options: Partial<RoomSessionOptions> = {}): RoomSession {
  const session = new RoomSession({ myIdentity: "alice", myLanguage: "ja", roomName: "r", ...options });
  sessions.push(session);
  return session;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  sessions.splice(0).forEach((s) => s.dispose());
  vi.restoreAllMocks();
});

describe("字幕とテキスト入力", () => {
  test("送信元が Agent の参加者の字幕だけを出す", () => {
    const session = newSession();
    let notified = 0;
    session.subscribe(() => notified++);

    // 送信元が分からないもの(Server API から、または受け手がまだ知らない参加者から)
    session.handleData(captionData({ segmentId: "from-null" }), undefined, captionTopic);
    // Agent 以外の参加者が送ったもの
    session.handleData(captionData({ segmentId: "from-standard" }), mallory, captionTopic);
    expect(session.captions.segments).toEqual([]);
    expect(notified).toBe(0);

    session.handleData(captionData({ segmentId: "from-agent" }), agent, captionTopic);
    expect(session.captions.segments.map((s) => s.segmentId)).toEqual(["from-agent"]);
    expect(notified).toBe(1);
  });

  test("Agent 以外が送った自分の message_id の字幕では、送り直しを止めない", () => {
    const session = newSession();
    const id = session.textSender.submit("はい")!.messageId;

    session.handleData(captionData({ messageId: id, speaker: "alice" }), mallory, captionTopic);
    expect(session.textSender.find(id)!.state).toBe("sending");

    session.handleData(captionData({ messageId: id, speaker: "alice" }), agent, captionTopic);
    expect(session.textSender.find(id)!.state).toBe("delivered");
  });

  test("Agent の参加者からの TextStatus だけで、送信中の表示を変える", () => {
    const session = newSession();
    const id = session.textSender.submit("長い")!.messageId;
    const status = toBinary(
      TextStatusSchema,
      create(TextStatusSchema, { messageId: id, state: TextStatus_State.REJECTED, reason: TextStatus_Reason.TOO_LONG }),
    );

    session.handleData(status, undefined, textStatusTopic);
    session.handleData(status, mallory, textStatusTopic);
    expect(session.textSender.find(id)!.state).toBe("sending");

    session.handleData(status, agent, textStatusTopic);
    expect(session.textSender.find(id)!.state).toBe("rejected");
  });
});

describe("画像・動画", () => {
  test("topic media は履歴で確かめてからルームの表示に足す", async () => {
    const row = mediaEvent("2026-10-13T00:00:01.000Z", { senderId: "bob" });
    let fetches = 0;
    const session = newSession({
      fetchRecentTimeline: async () => {
        fetches++;
        return [row];
      },
    });
    let notified = 0;
    session.subscribe(() => notified++);

    // ほかの topic には MediaMessage を読ませない
    session.handleData(messageFor(row), undefined, "text");
    session.handleData(messageFor(row), undefined, mediaTopic);
    await flush();
    expect(fetches).toBe(1);
    expect(session.media.items.map((e) => e.event_id)).toEqual([row.event_id]);
    expect(notified).toBe(1);

    // complete のやり直しで同じものが届いても、読まずに捨てる
    session.handleData(messageFor(row), undefined, mediaTopic);
    await flush();
    expect(fetches).toBe(1);
    expect(session.media.items).toHaveLength(1);
  });

  test("履歴を読めない作りでは topic media を捨てる", async () => {
    const session = newSession();
    session.handleData(messageFor(mediaEvent("2026-10-13T00:00:01.000Z")), undefined, mediaTopic);
    await flush();
    expect(session.media.items).toEqual([]);
  });
});

describe("削除", () => {
  test("topic deletion を確かめて、字幕と画像・動画を「削除された…」にする", async () => {
    const text = ownText("2026-10-13T00:00:01.000Z", { senderId: "bob" });
    const media = mediaEvent("2026-10-13T00:00:02.000Z", { senderId: "bob" });
    const rows = new Map([
      [text.event_id, tombstoneOf(text)],
      [media.event_id, tombstoneOf(media)],
    ]);
    const session = newSession({ fetchTimelineEvent: async (id) => rows.get(id) ?? null });
    session.captions.apply(textCaption("s1", "はい", { speaker: "bob", messageId: "m1", isFinal: true }));
    session.addMedia([media]);

    for (const row of [text, media]) {
      session.handleData(deletionFor(row), undefined, deletionTopic);
    }
    await flush();

    expect(session.captions.segments[0]!.deleted).toBe(true);
    expect(session.media.isDeleted(media.event_id)).toBe(true);
  });

  test("入室時の履歴の墓石を反映する", () => {
    const session = newSession();
    session.captions.apply(textCaption("s1", "はい", { speaker: "alice", messageId: "m1", isFinal: true }));
    const media = mediaEvent("2026-10-13T00:00:02.000Z");

    session.applyTimeline([tombstoneOf(ownText("2026-10-13T00:00:01.000Z")), tombstoneOf(media)]);

    expect(session.captions.segments[0]!.deleted).toBe(true);
    expect(session.media.isDeleted(media.event_id)).toBe(true);
  });

  test("自分のテキストは、履歴に保存されるのを待ってから消す", async () => {
    const row = ownText("2026-10-13T00:00:01.000Z");
    let fetches = 0;
    const deleted: string[] = [];
    const session = newSession({
      fetchRecentTimeline: async () => {
        fetches++;
        // 2回目で Agent が保存した
        return fetches < 2 ? [] : [row];
      },
      deleteTimelineEvent: async (id) => {
        deleted.push(id);
        return tombstoneOf(row);
      },
      findTextRetryDelaysMs: [0, 0],
    });
    session.captions.apply(textCaption("s1", "はい", { speaker: "alice", messageId: "m1", isFinal: true }));
    const segment = session.captions.segments[0]!;
    expect(session.canDeleteCaption(segment)).toBe(true);

    await session.deleteOwnText(segment);

    expect(deleted).toEqual([row.event_id]);
    expect(session.captions.segments[0]!.deleted).toBe(true);
    expect(session.canDeleteCaption(segment)).toBe(false);
  });

  test("保存されないままなら NotSavedYetError", async () => {
    const session = newSession({
      fetchRecentTimeline: async () => [],
      deleteTimelineEvent: async (): Promise<TimelineEvent> => {
        throw new Error("呼ばれない");
      },
      findTextRetryDelaysMs: [0],
    });
    session.captions.apply(textCaption("s1", "はい", { speaker: "alice", messageId: "m1", isFinal: true }));

    await expect(session.deleteOwnText(session.captions.segments[0]!)).rejects.toBeInstanceOf(NotSavedYetError);
  });

  test("他人のテキストと画像・動画には消す操作を出さない", () => {
    const session = newSession({
      fetchRecentTimeline: async () => [],
      deleteTimelineEvent: async (): Promise<TimelineEvent> => {
        throw new Error("呼ばれない");
      },
    });
    session.captions.apply(textCaption("s1", "はい", { speaker: "bob", messageId: "m1", isFinal: true }));
    const mine = mediaEvent("2026-10-13T00:00:02.000Z");

    expect(session.canDeleteCaption(session.captions.segments[0]!)).toBe(false);
    expect(session.canDeleteMedia(mine)).toBe(true);
    expect(session.canDeleteMedia(mediaEvent("2026-10-13T00:00:03.000Z", { senderId: "bob" }))).toBe(false);
    expect(session.canDeleteMedia(tombstoneOf(mine))).toBe(false);
  });
});
