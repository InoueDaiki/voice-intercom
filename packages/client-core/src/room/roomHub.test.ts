import type { LocalAudioTrack } from "livekit-client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fakeAwake, fakePresence } from "../testing/fakePresence.ts";
import { fakeRoom } from "../testing/fakeRoom.ts";
import { flush } from "../testing/fixtures.ts";
import { RoomHub, type RoomSessionSeed } from "./roomHub.ts";
import { RoomSession } from "./roomSession.ts";
import { SharedMicrophone } from "./sharedMicrophone.ts";

// clone できる、偽のマイクのトラック
function fakeSourceTrack() {
  const mediaStreamTrack = { readyState: "live", clone: vi.fn(() => ({ stop: vi.fn() })) };
  const track = { mediaStreamTrack, stop: vi.fn() };
  return { track, asTrack: track as unknown as LocalAudioTrack };
}

// clone を、stop だけを持つトラックにする
const wrapClone = (clone: unknown) => clone as LocalAudioTrack;

// 作ったトラックを覚えておく、偽の SharedMicrophone
function fakeMicrophone() {
  const acquired: LocalAudioTrack[] = [];
  const released: LocalAudioTrack[] = [];
  const microphone = {
    acquire: vi.fn(async () => {
      const track = { mute: vi.fn(async () => {}), unmute: vi.fn(async () => {}), stop: vi.fn() };
      acquired.push(track as unknown as LocalAudioTrack);
      return track as unknown as LocalAudioTrack;
    }),
    release: vi.fn((track: LocalAudioTrack) => released.push(track)),
  };
  return { microphone: microphone as unknown as SharedMicrophone, acquired, released };
}

function setup() {
  const presence = fakePresence();
  const awake = fakeAwake();
  const mic = fakeMicrophone();
  const rooms = new Map<string, ReturnType<typeof fakeRoom>>();
  const getToken = vi.fn(async (roomId: string, audio: boolean) => ({ url: "wss://x", token: `${roomId}:${audio}` }));
  const setAudioAttribute = vi.fn(async () => {});
  const hub = new RoomHub({
    createSession: (seed: RoomSessionSeed) => {
      const fake = fakeRoom();
      rooms.set(seed.roomId, fake);
      return new RoomSession({ myIdentity: "alice", myLanguage: "ja", ...seed, room: fake.asRoom });
    },
    getToken,
    setAudioAttribute,
    presence: presence.presence,
    awake,
    microphone: mic.microphone,
  });
  hubs.push(hub);
  return { hub, presence, awake, mic, rooms, getToken, setAudioAttribute };
}

const hubs: RoomHub[] = [];

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  hubs.splice(0).forEach((h) => h.dispose());
  vi.restoreAllMocks();
});

describe("RoomHub", () => {
  test("画面を開くとデータだけでつなぎ、閉じると切る", async () => {
    const { hub, rooms, getToken, mic } = setup();

    const { session } = hub.open("room-a", "A");
    await flush();

    expect(getToken).toHaveBeenCalledWith("room-a", false);
    expect(session.connected).toBe(true);
    expect(session.audio).toBe(false);
    expect(mic.microphone.acquire).not.toHaveBeenCalled();
    expect(hub.audioRooms).toEqual([]);

    hub.close("room-a");
    expect(hub.get("room-a")).toBeUndefined();
    expect(rooms.get("room-a")?.room.disconnect).toHaveBeenCalled();
  });

  test("ルームの名前が変わっても切らず、表示の名前だけを変える", async () => {
    const { hub, rooms, getToken } = setup();
    const connection = hub.open("room-a", "A");
    await flush();
    const notified = vi.fn();
    hub.subscribe(notified);

    hub.setRoomName("room-a", "B");

    expect(hub.get("room-a")).toBe(connection);
    expect(connection.roomName).toBe("B");
    expect(connection.session.roomName).toBe("B");
    expect(notified).toHaveBeenCalled();
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(rooms.get("room-a")?.room.disconnect).not.toHaveBeenCalled();
  });

  test("作り直した RoomHub で、音声をつないでいたルームをつなぎ直す", async () => {
    const before = setup();
    before.hub.open("room-a", "A");
    await before.hub.setAudio("room-a", "A", true);
    before.hub.open("room-b", "B");
    await flush();
    const audioRooms = before.hub.audioRooms.map(({ roomId, roomName }) => ({ roomId, roomName }));
    before.hub.dispose();

    const after = setup();
    after.hub.resumeAudio(audioRooms);
    await flush();

    expect(after.hub.audioRooms.map((r) => r.roomId)).toEqual(["room-a"]);
    expect(after.hub.get("room-a")?.session.connected).toBe(true);
    expect(after.getToken).toHaveBeenCalledWith("room-a", true);
    expect(after.hub.get("room-b")).toBeUndefined();
  });

  test("音声をつないだルームは、画面を閉じてもつないだまま", async () => {
    const { hub, rooms, setAudioAttribute } = setup();
    hub.open("room-a", "A");
    await flush();

    await hub.setAudio("room-a", "A", true);
    hub.close("room-a");

    expect(setAudioAttribute).toHaveBeenCalledWith("room-a", true);
    expect(hub.audioRooms.map((r) => r.roomId)).toEqual(["room-a"]);
    expect(rooms.get("room-a")?.room.disconnect).not.toHaveBeenCalled();

    // 画面を開いていなければ、音声を切ると切断する
    await hub.setAudio("room-a", "A", false);
    expect(hub.get("room-a")).toBeUndefined();
    expect(rooms.get("room-a")?.room.disconnect).toHaveBeenCalled();
  });

  test("画面を開いていないルームでも音声をつなげる(トークンは audio で取る)", async () => {
    const { hub, getToken, mic } = setup();

    await hub.setAudio("room-b", "B", true);
    await flush();

    expect(getToken).toHaveBeenCalledWith("room-b", true);
    expect(hub.get("room-b")?.session.connected).toBe(true);
    expect(mic.microphone.acquire).toHaveBeenCalledTimes(1);
  });

  test("ふだんの PTT は音声をつないだ全部のルームに、ルームごとの PTT はそのルームだけに届く", async () => {
    const { hub, mic } = setup();
    await hub.setAudio("room-a", "A", true);
    await hub.setAudio("room-b", "B", true);
    hub.open("room-c", "C");
    await flush();
    const [a, b] = hub.audioRooms.map((r) => r.session);

    hub.setPressingAll(true);
    await flush();

    expect(a?.talking).toBe(true);
    expect(b?.talking).toBe(true);
    // 音声をつないでいないルームには届かない
    expect(hub.get("room-c")?.session.pressing).toBe(false);
    expect(hub.pressingAny).toBe(true);

    hub.setPressingAll(false);
    b?.setPressing(true);
    await flush();

    expect(a?.talking).toBe(false);
    expect(b?.talking).toBe(true);
    // マイクはルームごとに分けたトラック
    expect(mic.acquired).toHaveLength(2);
  });

  test("隠れたら、音声をつないだ全部のルームで PTT を離す", async () => {
    const { hub, presence } = setup();
    await hub.setAudio("room-a", "A", true);
    await hub.setAudio("room-b", "B", true);
    await flush();
    hub.setPressingAll(true);

    presence.change("hidden");

    expect(hub.pressingAny).toBe(false);
  });

  test("画面を消させないのは、音声をつないだルームが1つでもある間だけ", async () => {
    const { hub, awake } = setup();
    hub.open("room-a", "A");
    await flush();
    expect(awake.held).toBe(false);

    await hub.setAudio("room-a", "A", true);
    await hub.setAudio("room-b", "B", true);
    await flush();
    expect(awake.held).toBe(true);

    await hub.setAudio("room-a", "A", false);
    expect(awake.held).toBe(true);
    await hub.setAudio("room-b", "B", false);
    expect(awake.held).toBe(false);
  });

  test("drop は画面を開いていても切る", async () => {
    const { hub, mic } = setup();
    hub.open("room-a", "A");
    await hub.setAudio("room-a", "A", true);
    await flush();

    hub.drop("room-a");

    expect(hub.get("room-a")).toBeUndefined();
    expect(mic.released).toEqual(mic.acquired);
  });
});

describe("RoomHub.rejoinAll", () => {
  test("トークンを取れずに止まったルームだけ入り直し、つないでいるルームには触らない", async () => {
    const { hub, getToken } = setup();
    getToken.mockRejectedValueOnce(new Error("ログインが切れています"));
    const stopped = hub.open("r1", "ルーム1");
    await flush();
    const connected = hub.open("r2", "ルーム2");
    await flush();
    expect(stopped.keeper.joinError).toBeDefined();
    expect(connected.session.connected).toBe(true);
    getToken.mockClear();

    hub.rejoinAll();
    await flush();

    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith("r1", false);
    expect(stopped.session.connected).toBe(true);
    expect(stopped.keeper.joinError).toBeUndefined();
  });

  test("また失敗しても、やり直し続けない", async () => {
    const { hub, getToken } = setup();
    getToken.mockRejectedValue(new Error("offline"));
    hub.open("r1", "ルーム1");
    await flush();
    getToken.mockClear();

    hub.rejoinAll();
    await flush();
    await flush();

    expect(getToken).toHaveBeenCalledTimes(1);
  });
});

describe("SharedMicrophone", () => {
  test("マイクは1回だけ取り、ルームごとに clone を渡し、全部を放したら元も放す", async () => {
    const source = fakeSourceTrack();
    const create = vi.fn(async () => source.asTrack);
    const microphone = new SharedMicrophone(create, wrapClone);

    const [a, b] = await Promise.all([microphone.acquire(), microphone.acquire()]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(source.track.mediaStreamTrack.clone).toHaveBeenCalledTimes(2);
    expect(a).not.toBe(b);

    microphone.release(a);
    await flush();
    expect(source.track.stop).not.toHaveBeenCalled();
    microphone.release(b);
    await flush();
    expect(source.track.stop).toHaveBeenCalledTimes(1);
  });

  test("clone できない(React Native)なら、元のトラックを1つ目のルームに渡し、2つ目からはルームごとに取る", async () => {
    const tracks = [fakeSourceTrack(), fakeSourceTrack(), fakeSourceTrack()];
    for (const t of tracks) {
      t.track.mediaStreamTrack.clone = vi.fn(() => {
        throw new Error("Not implemented.");
      });
    }
    const create = vi.fn();
    for (const t of tracks) {
      create.mockResolvedValueOnce(t.asTrack);
    }
    const microphone = new SharedMicrophone(create, wrapClone);
    vi.spyOn(console, "info").mockImplementation(() => {});

    const [a, b] = await Promise.all([microphone.acquire(), microphone.acquire()]);
    const c = await microphone.acquire();

    expect(a).toBe(tracks[0]?.asTrack);
    expect(b).toBe(tracks[1]?.asTrack);
    expect(c).toBe(tracks[2]?.asTrack);
    expect(create).toHaveBeenCalledTimes(3);

    microphone.release(a);
    expect(tracks[0]?.track.stop).toHaveBeenCalledTimes(1);
  });

  test("元のマイクが止まっていたら取り直す", async () => {
    const first = fakeSourceTrack();
    const second = fakeSourceTrack();
    const create = vi.fn().mockResolvedValueOnce(first.asTrack).mockResolvedValueOnce(second.asTrack);
    const microphone = new SharedMicrophone(create, wrapClone);
    await microphone.acquire();

    first.track.mediaStreamTrack.readyState = "ended";
    await microphone.acquire();

    expect(create).toHaveBeenCalledTimes(2);
    expect(second.track.mediaStreamTrack.clone).toHaveBeenCalledTimes(1);
  });
});
