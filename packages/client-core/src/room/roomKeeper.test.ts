import { DisconnectReason, RoomEvent } from "livekit-client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fakeMic, fakeRoom } from "../testing/fakeRoom.ts";
import { flush } from "../testing/fixtures.ts";
import { fakeAwake, fakePresence } from "../testing/fakePresence.ts";
import { type PresenceChange, RoomKeeper, type ScreenAwake } from "./roomKeeper.ts";
import { RoomSession } from "./roomSession.ts";

const keepers: RoomKeeper[] = [];

function setup(options: { visible?: boolean; getToken?: () => Promise<{ url: string; token: string }> } = {}) {
  const { room, asRoom } = fakeRoom();
  const mics: ReturnType<typeof fakeMic>[] = [];
  const fetchTimelinePage = vi.fn(async () => ({ items: [], next_before: null }));
  const session = new RoomSession({
    myIdentity: "alice",
    myLanguage: "ja",
    roomName: "r",
    room: asRoom,
    fetchTimelinePage,
    createMicTrack: async () => {
      const mic = fakeMic();
      mics.push(mic);
      return mic.asTrack;
    },
  });
  const presence = fakePresence(options.visible ?? true);
  const awake = fakeAwake();
  let now = 0;
  let issued = 0;
  const getToken = vi.fn(options.getToken ?? (async () => ({ url: "wss://example", token: `token-${++issued}` })));
  const keeper = new RoomKeeper({
    session,
    getToken,
    presence: presence.presence,
    awake: awake satisfies ScreenAwake,
    now: () => now,
  });
  keepers.push(keeper);
  return {
    room,
    session,
    keeper,
    mics,
    presence,
    awake,
    getToken,
    fetchTimelinePage,
    advance(ms: number) {
      now += ms;
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of keepers.splice(0)) {
    k.dispose();
    k.session.dispose();
  }
  vi.restoreAllMocks();
});

describe("隠れたら PTT を離す", () => {
  test.each<PresenceChange>(["hidden", "inactive"])("押して話している間に %s になったら、ミュートに戻す", async (change) => {
    const { session, keeper, mics, presence } = setup();
    await keeper.start();
    session.setPressing(true);
    await flush();
    expect(session.talking).toBe(true);

    presence.change(change);
    expect(session.pressing).toBe(false);
    await flush();
    expect(mics[0]!.track.mute).toHaveBeenLastCalledWith();
    expect(mics[0]!.track.mute.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      mics[0]!.track.unmute.mock.invocationCallOrder.at(-1)!,
    );
    expect(session.talking).toBe(false);
  });

  test("ミュートを外している途中で隠れても、最後はミュートにそろう", async () => {
    const { session, keeper, mics, presence } = setup();
    await keeper.start();
    let finishUnmute!: () => void;
    mics[0]!.track.unmute.mockImplementation(() => new Promise<void>((resolve) => (finishUnmute = resolve)));

    session.setPressing(true);
    await flush();
    presence.change("hidden");
    finishUnmute();
    await flush();

    expect(session.pressing).toBe(false);
    expect(session.talking).toBe(false);
    expect(mics[0]!.track.mute).toHaveBeenCalledTimes(2); // publish の前と、離したとき
  });

  test("戻っても押した状態には戻さない", async () => {
    const { session, keeper, mics, presence } = setup();
    await keeper.start();
    session.setPressing(true);
    await flush();
    presence.change("hidden");
    presence.change("visible");
    await flush();

    expect(session.pressing).toBe(false);
    expect(session.talking).toBe(false);
    expect(mics[0]!.track.unmute).toHaveBeenCalledTimes(1);
  });

  test("dispose した後は見え方を聞かない", async () => {
    const { keeper, presence } = setup();
    await keeper.start();
    expect(presence.listenerCount()).toBe(1);
    keeper.dispose();
    expect(presence.listenerCount()).toBe(0);
  });
});

describe("戻ったら入り直す", () => {
  test("隠れている間に切断されたら(Chrome の freeze など)、戻ったときに新しいトークンで入り直す", async () => {
    const { room, session, keeper, mics, presence, getToken, fetchTimelinePage } = setup();
    await keeper.start();
    await flush();
    const reconnected = vi.fn();
    session.onReconnected = reconnected;

    presence.change("hidden");
    room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
    expect(session.connected).toBe(false);
    expect(session.error).toBeDefined();
    // 切断で前のマイクを放す
    expect(mics[0]!.track.stop).toHaveBeenCalled();
    // 隠れている間は入り直さない
    await flush();
    expect(getToken).toHaveBeenCalledTimes(1);

    const historyReads = fetchTimelinePage.mock.calls.length;
    presence.change("visible");
    await flush();

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(room.connect).toHaveBeenLastCalledWith("wss://example", "token-2", { autoSubscribe: false });
    expect(session.connected).toBe(true);
    expect(session.error).toBeUndefined();
    expect(keeper.rejoining).toBe(false);
    // マイクを作り直し、ミュートのまま publish する
    expect(mics).toHaveLength(2);
    expect(mics[1]!.track.mute).toHaveBeenCalled();
    expect(mics[1]!.track.unmute).not.toHaveBeenCalled();
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
    // 履歴を読み直して、切れていた間の行を埋める
    expect(fetchTimelinePage.mock.calls.length).toBeGreaterThan(historyReads);
    expect(reconnected).toHaveBeenCalledTimes(1);
    // Room のイベントは聞き直さない(同じハンドラーを重ねない)
    expect(room.on.mock.calls.filter(([event]) => event === RoomEvent.Disconnected)).toHaveLength(1);
  });

  test("つながったままなら入り直さない", async () => {
    const { keeper, presence, getToken, room } = setup();
    await keeper.start();
    presence.change("hidden");
    presence.change("visible");
    await flush();
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(room.connect).toHaveBeenCalledTimes(1);
  });

  test.each([DisconnectReason.DUPLICATE_IDENTITY, DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.ROOM_DELETED])(
    "追い出された(理由 %s)なら入り直さない",
    async (reason) => {
      const { room, session, keeper, presence, getToken } = setup();
      await keeper.start();
      presence.change("hidden");
      room.emit(RoomEvent.Disconnected, reason);
      presence.change("visible");
      await flush();
      expect(session.canRejoin).toBe(false);
      expect(getToken).toHaveBeenCalledTimes(1);
    },
  );

  test("トークンを取れなければ joinError に入れ、次に戻ったときにまた試す", async () => {
    let fail = false;
    const { room, session, keeper, presence, getToken } = setup({
      getToken: async () => {
        if (fail) {
          throw new Error("ネットワーク");
        }
        return { url: "wss://example", token: "t" };
      },
    });
    await keeper.start();
    room.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE);

    fail = true;
    presence.change("hidden");
    presence.change("visible");
    await flush();
    expect(keeper.joinError).toBeInstanceOf(Error);
    expect(session.connected).toBe(false);

    fail = false;
    presence.change("hidden");
    presence.change("visible");
    await flush();
    expect(getToken).toHaveBeenCalledTimes(3);
    expect(keeper.joinError).toBeUndefined();
    expect(session.connected).toBe(true);
  });

  test("戻ったとき、音が止められていれば「音を出す」を出す", async () => {
    const { room, session, keeper, presence } = setup();
    await keeper.start();
    expect(session.canPlaybackAudio).toBe(true);

    presence.change("hidden");
    room.canPlaybackAudio = false;
    presence.change("visible");
    expect(session.canPlaybackAudio).toBe(false);
  });
});

describe("画面を消させない", () => {
  test("入室中で見えている間だけ持ち、隠れたら放し、戻ったら取り直す", async () => {
    const { keeper, presence, awake } = setup();
    expect(awake.held).toBe(false);
    await keeper.start();
    expect(awake.held).toBe(true);

    presence.change("hidden");
    expect(awake.held).toBe(false);
    presence.change("visible");
    expect(awake.held).toBe(true);

    keeper.dispose();
    expect(awake.held).toBe(false);
  });

  test("切断されたら放す", async () => {
    const { room, keeper, awake } = setup();
    await keeper.start();
    room.emit(RoomEvent.Disconnected, DisconnectReason.ROOM_DELETED);
    expect(awake.held).toBe(false);
  });

  test("隠れたまま入室したら、見えるまで持たない", async () => {
    const { keeper, presence, awake } = setup({ visible: false });
    await keeper.start();
    expect(awake.held).toBe(false);
    presence.change("visible");
    expect(awake.held).toBe(true);
  });
});

describe("隠れていた間の知らせ", () => {
  test("しばらく隠れていたら、戻ったときに知らせ、閉じられる", async () => {
    const { keeper, presence, advance } = setup();
    await keeper.start();

    presence.change("hidden");
    advance(1000);
    presence.change("visible");
    expect(keeper.awayNotice).toBe(false);

    presence.change("hidden");
    advance(5000);
    presence.change("visible");
    expect(keeper.awayNotice).toBe(true);

    keeper.dismissAwayNotice();
    expect(keeper.awayNotice).toBe(false);
  });

  test("隠れている間に切断されていたら、短くても知らせる", async () => {
    const { room, keeper, presence, advance } = setup();
    await keeper.start();
    presence.change("hidden");
    room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
    advance(500);
    presence.change("visible");
    expect(keeper.awayNotice).toBe(true);
  });

  test("フォーカスを失っただけ(まだ見えている)なら知らせない", async () => {
    const { keeper, presence, advance } = setup();
    await keeper.start();
    presence.change("inactive");
    advance(60_000);
    presence.change("visible");
    expect(keeper.awayNotice).toBe(false);
  });
});
