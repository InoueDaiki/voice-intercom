import { create, toBinary } from "@bufbuild/protobuf";
import { CaptionSchema } from "@voice-intercom/schema/voiceintercom/v1/caption_pb";
import {
  TextStatus_Reason,
  TextStatus_State,
  TextStatusSchema,
} from "@voice-intercom/schema/voiceintercom/v1/text_status_pb";
import { type LocalAudioTrack, ParticipantKind } from "livekit-client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TimelineEvent } from "../api.ts";
import { deferred, fakeMic, fakeRoom, fakeSpeaker } from "../testing/fakeRoom.ts";
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
      fetchTimelinePage: async () => {
        fetches++;
        return { items: [row], next_before: null };
      },
    });
    let notified = 0;
    session.subscribe(() => notified++);

    // ほかの topic には MediaMessage を読ませない
    session.handleData(messageFor(row), undefined, "text");
    session.handleData(messageFor(row), undefined, mediaTopic);
    await flush();
    expect(fetches).toBe(1);
    expect(session.timeline.media.map((e) => e.event_id)).toEqual([row.event_id]);
    expect(notified).toBe(1);

    // complete のやり直しで同じものが届いても、読まずに捨てる
    session.handleData(messageFor(row), undefined, mediaTopic);
    await flush();
    expect(fetches).toBe(1);
    expect(session.timeline.media).toHaveLength(1);
  });

  test("履歴を読めない作りでは topic media を捨てる", async () => {
    const session = newSession();
    session.handleData(messageFor(mediaEvent("2026-10-13T00:00:01.000Z")), undefined, mediaTopic);
    await flush();
    expect(session.timeline.media).toEqual([]);
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
    expect(session.timeline.isDeleted(media.event_id)).toBe(true);
  });

  test("入室時の履歴の墓石を反映する", () => {
    const session = newSession();
    session.captions.apply(textCaption("s1", "はい", { speaker: "alice", messageId: "m1", isFinal: true }));
    const media = mediaEvent("2026-10-13T00:00:02.000Z");

    session.applyTimeline([tombstoneOf(ownText("2026-10-13T00:00:01.000Z")), tombstoneOf(media)]);

    expect(session.captions.segments[0]!.deleted).toBe(true);
    expect(session.timeline.isDeleted(media.event_id)).toBe(true);
  });

  test("自分のテキストは、履歴に保存されるのを待ってから消す", async () => {
    const row = ownText("2026-10-13T00:00:01.000Z");
    let fetches = 0;
    const deleted: string[] = [];
    const session = newSession({
      fetchTimelinePage: async () => {
        fetches++;
        // 2回目で Agent が保存した
        return { items: fetches < 2 ? [] : [row], next_before: null };
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
      fetchTimelinePage: async () => ({ items: [], next_before: null }),
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
      fetchTimelinePage: async () => ({ items: [], next_before: null }),
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

describe("入室とマイク", () => {
  test("入室を待つ間に PTT を押していたら、入室したらミュートを外す", async () => {
    const connecting = deferred<void>();
    const { asRoom } = fakeRoom({ connect: () => connecting.promise });
    const mic = fakeMic();
    const session = newSession({ room: asRoom, createMicTrack: async () => mic.asTrack });

    const joined = session.connect("wss://example", "token");
    session.setPressing(true);
    await flush();
    expect(mic.track.unmute).not.toHaveBeenCalled();

    connecting.resolve();
    await joined;
    await flush();
    expect(session.connected).toBe(true);
    expect(mic.track.unmute).toHaveBeenCalledTimes(1);
    expect(session.talking).toBe(true);
  });

  test("マイクのトラックを作っている間に dispose されたら、トラックを止めてやめる", async () => {
    const creating = deferred<LocalAudioTrack>();
    const { room, asRoom } = fakeRoom();
    const mic = fakeMic();
    const startBackground = vi.fn(async () => true);
    const session = newSession({ room: asRoom, createMicTrack: () => creating.promise, platform: { startBackground } });

    const joined = session.connect("wss://example", "token");
    await flush();
    session.dispose();
    creating.resolve(mic.asTrack);
    await joined;

    expect(mic.track.stop).toHaveBeenCalled();
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(startBackground).not.toHaveBeenCalled();
    expect(session.connected).toBe(false);
    expect(session.error).toBeUndefined();
  });

  test("publish している間に dispose されたら、トラックを止めてやめる", async () => {
    const publishing = deferred<unknown>();
    const { asRoom } = fakeRoom({ publishTrack: () => publishing.promise });
    const mic = fakeMic();
    const startBackground = vi.fn(async () => true);
    const session = newSession({ room: asRoom, createMicTrack: async () => mic.asTrack, platform: { startBackground } });

    const joined = session.connect("wss://example", "token");
    await flush();
    session.dispose();
    // 切断で publish が失敗しても、エラーにはしない
    publishing.reject(new Error("切断された"));
    await joined;

    expect(mic.track.stop).toHaveBeenCalled();
    expect(startBackground).not.toHaveBeenCalled();
    expect(session.error).toBeUndefined();
  });

  test("publish できなければトラックを止める", async () => {
    const { asRoom } = fakeRoom({
      publishTrack: async () => {
        throw new Error("失敗");
      },
    });
    const mic = fakeMic();
    const session = newSession({ room: asRoom, createMicTrack: async () => mic.asTrack });

    await expect(session.connect("wss://example", "token")).rejects.toThrow("失敗");
    expect(mic.track.stop).toHaveBeenCalled();
    expect(session.error).toContain("入室できなかった");
  });

  test("dispose でマイクのトラックを止める", async () => {
    const { asRoom } = fakeRoom();
    const mic = fakeMic();
    const session = newSession({ room: asRoom, createMicTrack: async () => mic.asTrack });

    await session.connect("wss://example", "token");
    expect(mic.track.stop).not.toHaveBeenCalled();
    session.dispose();
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
  });
});

describe("音声をつなぐ・切る", () => {
  test("audio が false なら、データだけでつなぐ(マイクを publish せず、音声を購読しない)", async () => {
    const { room, asRoom } = fakeRoom();
    const bob = fakeSpeaker("bob");
    room.remoteParticipants.set("bob", bob.participant);
    const createMicTrack = vi.fn(async () => fakeMic().asTrack);
    const startBackground = vi.fn(async () => true);
    const session = newSession({ room: asRoom, audio: false, createMicTrack, platform: { startBackground } });

    await session.connect("wss://example", "token");
    session.setPressing(true);
    await flush();

    expect(session.connected).toBe(true);
    expect(createMicTrack).not.toHaveBeenCalled();
    expect(bob.pub.setSubscribed).not.toHaveBeenCalled();
    expect(startBackground).not.toHaveBeenCalled();
    // 音声をつないでいなければ、PTT は押せない
    expect(session.pressing).toBe(false);
  });

  test("つないだまま音声をつなぐと、マイクを publish し、購読し、属性を変える", async () => {
    const { room, asRoom } = fakeRoom();
    const bob = fakeSpeaker("bob");
    room.remoteParticipants.set("bob", bob.participant);
    const mic = fakeMic();
    const setAudioAttribute = vi.fn(async () => {});
    const session = newSession({
      room: asRoom,
      audio: false,
      createMicTrack: async () => mic.asTrack,
      setAudioAttribute,
    });
    await session.connect("wss://example", "token");

    await session.setAudio(true);

    expect(session.audio).toBe(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(mic.track.mute).toHaveBeenCalled();
    expect(bob.pub.setSubscribed).toHaveBeenCalledWith(true);
    expect(setAudioAttribute).toHaveBeenCalledWith(true);

    session.setPressing(true);
    await flush();
    expect(session.talking).toBe(true);
  });

  test("音声を切ると、PTT を離し、マイクを unpublish して放し、購読をやめる", async () => {
    const { room, asRoom } = fakeRoom();
    const bob = fakeSpeaker("bob");
    room.remoteParticipants.set("bob", bob.participant);
    const mic = fakeMic();
    const releaseMicTrack = vi.fn();
    const setAudioAttribute = vi.fn(async () => {});
    const session = newSession({
      room: asRoom,
      createMicTrack: async () => mic.asTrack,
      releaseMicTrack,
      setAudioAttribute,
    });
    await session.connect("wss://example", "token");
    // トークンで audio を入れたので、入っただけでは属性を変えない
    expect(setAudioAttribute).not.toHaveBeenCalled();
    expect(bob.pub.isSubscribed).toBe(true);
    session.setPressing(true);

    await session.setAudio(false);

    expect(session.pressing).toBe(false);
    expect(session.talking).toBe(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(mic.asTrack, false);
    expect(releaseMicTrack).toHaveBeenCalledWith(mic.asTrack);
    expect(bob.pub.setSubscribed).toHaveBeenLastCalledWith(false);
    expect(setAudioAttribute).toHaveBeenCalledWith(false);
    // dispose で2度は放さない
    session.dispose();
    expect(releaseMicTrack).toHaveBeenCalledTimes(1);
  });

  test("入室を待つ間に音声を切り替えたら、入室した後に属性を揃える", async () => {
    const connecting = deferred<void>();
    const { asRoom } = fakeRoom({ connect: () => connecting.promise });
    const setAudioAttribute = vi.fn(async () => {});
    const createMicTrack = vi.fn(async () => fakeMic().asTrack);
    const session = newSession({ room: asRoom, audio: false, createMicTrack, setAudioAttribute });

    const joined = session.connect("wss://example", "token");
    const switched = session.setAudio(true);
    connecting.resolve();
    await joined;
    await switched;
    await flush();

    expect(createMicTrack).toHaveBeenCalledTimes(1);
    expect(setAudioAttribute).toHaveBeenCalledWith(true);
  });

  test("つないでいない間に切り替えたら、次に入るときに使う", async () => {
    const setAudioAttribute = vi.fn(async () => {});
    const session = newSession({ audio: false, setAudioAttribute });

    await session.setAudio(true);

    expect(session.audio).toBe(true);
    expect(setAudioAttribute).not.toHaveBeenCalled();
  });
});
