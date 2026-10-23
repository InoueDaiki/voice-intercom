import type { LocalAudioTrack } from "livekit-client";

import { Observable } from "../observable.ts";
import { type AppPresence, type JoinToken, RoomKeeper, type ScreenAwake } from "./roomKeeper.ts";
import type { RoomSession } from "./roomSession.ts";
import { SharedMicrophone } from "./sharedMicrophone.ts";

// RoomHub が RoomSession を作るときに渡すもの
export interface RoomSessionSeed {
  roomId: string;
  roomName: string;
  // 最初に音声をつなぐか
  audio: boolean;
  createMicTrack: () => Promise<LocalAudioTrack>;
  releaseMicTrack: (track: LocalAudioTrack) => void;
  setAudioAttribute: (enabled: boolean) => Promise<void>;
}

export interface RoomHubOptions {
  // ルームの接続を作る(履歴の読み方などは各アプリが決める)。seed をそのまま RoomSession に渡す
  createSession: (seed: RoomSessionSeed) => RoomSession;
  // LiveKit のトークン(API の POST /livekit/token)。audio は参加者の属性に入る
  getToken: (roomId: string, audio: boolean) => Promise<JoinToken>;
  // 参加者の属性 audio を変える(API の PUT /rooms/{room_id}/audio)
  setAudioAttribute: (roomId: string, enabled: boolean) => Promise<void>;
  presence: AppPresence;
  awake?: ScreenAwake;
  // テストで差し替える
  microphone?: SharedMicrophone;
}

// 1つのルームの接続
export interface RoomConnection {
  roomId: string;
  roomName: string;
  session: RoomSession;
  keeper: RoomKeeper;
}

interface Entry extends RoomConnection {
  // ルームの画面を開いている数
  viewers: number;
  unsubscribes: (() => void)[];
}

// ルームの接続をまとめて持つ(設計メモの「ユーザーの3つの状態の表し方」)。
// - ルームの画面を開いている間は、データだけでつなぐ(状態 2。open / close)
// - 音声をつないだルームは、画面を離れてもつないだまま(状態 3。setAudio)。いくつでもつなげる
// - PTT は、ふだんは音声をつないだ全部のルームに届け(setPressingAll)、ルームごとにも押せる
//   (RoomSession.setPressing)
// - 画面を開いておらず、音声もつないでいないルームは切る
export class RoomHub extends Observable {
  private readonly options: RoomHubOptions;
  private readonly microphone: SharedMicrophone;
  private readonly entries = new Map<string, Entry>();
  private readonly awake: SharedScreenAwake | undefined;
  private disposed = false;

  constructor(options: RoomHubOptions) {
    super();
    this.options = options;
    this.microphone = options.microphone ?? new SharedMicrophone();
    this.awake = options.awake && new SharedScreenAwake(options.awake);
  }

  // ルームの接続(つないでいなければ undefined)
  get(roomId: string): RoomConnection | undefined {
    return this.entries.get(roomId);
  }

  // 音声をつないでいるルーム(つないだ順)
  get audioRooms(): RoomConnection[] {
    return [...this.entries.values()].filter((e) => e.session.audio);
  }

  // どれかのルームで PTT を押しているか
  get pressingAny(): boolean {
    return this.audioRooms.some((e) => e.session.pressing);
  }

  // ルームの画面を開いた。つないでいなければ、データだけでつなぐ。閉じたら close を呼ぶ
  open(roomId: string, roomName: string): RoomConnection {
    const entry = this.ensure(roomId, roomName, false);
    entry.viewers++;
    return entry;
  }

  // ルームの画面を閉じた。音声をつないでいなければ切る
  close(roomId: string): void {
    const entry = this.entries.get(roomId);
    if (!entry) {
      return;
    }
    entry.viewers = Math.max(0, entry.viewers - 1);
    this.dropIfUnused(entry);
  }

  // 音声をつなぐ・切る。画面を開いていないルームでも、つないでいなければつなぐ
  async setAudio(roomId: string, roomName: string, enabled: boolean): Promise<void> {
    const entry = enabled ? this.ensure(roomId, roomName, true) : this.entries.get(roomId);
    if (!entry) {
      return;
    }
    this.changed();
    await entry.session.setAudio(enabled);
    this.changed();
    this.dropIfUnused(entry);
  }

  // 音声をつないだ全部のルームで、PTT を押す・離す
  setPressingAll(value: boolean): void {
    for (const e of this.audioRooms) {
      e.session.setPressing(value);
    }
  }

  // ルームを抜けた・アーカイブされた・消されたときに、画面によらず切る
  drop(roomId: string): void {
    const entry = this.entries.get(roomId);
    if (entry) {
      this.disposeEntry(entry);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    for (const entry of [...this.entries.values()]) {
      this.disposeEntry(entry);
    }
    this.disposed = true;
  }

  private ensure(roomId: string, roomName: string, audio: boolean): Entry {
    const existing = this.entries.get(roomId);
    if (existing) {
      return existing;
    }
    const session = this.options.createSession({
      roomId,
      roomName,
      audio,
      createMicTrack: () => this.microphone.acquire(),
      releaseMicTrack: (track) => this.microphone.release(track),
      setAudioAttribute: (enabled) => this.options.setAudioAttribute(roomId, enabled),
    });
    const keeper = new RoomKeeper({
      session,
      // 入室と入り直しのたびに、そのときの audio で新しいトークンを取る
      getToken: () => this.options.getToken(roomId, session.audio),
      presence: this.options.presence,
      awake: this.awake?.lease(),
    });
    const entry: Entry = {
      roomId,
      roomName,
      session,
      keeper,
      viewers: 0,
      // 音声中の帯などが、どのルームの変化でも描き直せるよう伝える
      unsubscribes: [session.subscribe(() => this.changed()), keeper.subscribe(() => this.changed())],
    };
    this.entries.set(roomId, entry);
    // 入れなかった理由は keeper.joinError に入る
    keeper.start().catch(() => {});
    this.changed();
    return entry;
  }

  private dropIfUnused(entry: Entry): void {
    if (entry.viewers === 0 && !entry.session.audio && this.entries.get(entry.roomId) === entry) {
      this.disposeEntry(entry);
    }
  }

  private disposeEntry(entry: Entry): void {
    this.entries.delete(entry.roomId);
    for (const u of entry.unsubscribes.splice(0)) {
      u();
    }
    entry.keeper.dispose();
    entry.session.dispose();
    this.changed();
  }
}

// 画面を消させない仕組みを、複数のルームで分けて使う。どれかが持っていれば持つ
class SharedScreenAwake {
  private readonly target: ScreenAwake;
  private readonly holders = new Set<object>();

  constructor(target: ScreenAwake) {
    this.target = target;
  }

  lease(): ScreenAwake {
    const holder = {};
    return {
      acquire: () => {
        this.holders.add(holder);
        this.target.acquire();
      },
      release: () => {
        this.holders.delete(holder);
        if (this.holders.size === 0) {
          this.target.release();
        }
      },
    };
  }
}
