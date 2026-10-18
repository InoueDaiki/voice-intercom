// 入室とマイクのテストのための、偽の Room とマイクのトラック
import type { LocalAudioTrack, Room } from "livekit-client";
import { vi } from "vitest";

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function fakeMic() {
  const track = {
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  return { track, asTrack: track as unknown as LocalAudioTrack };
}

// on で付けたハンドラーを emit で呼べる
export function fakeRoom(options: { connect?: () => Promise<void>; publishTrack?: () => Promise<unknown> } = {}) {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const room = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return room;
    }),
    emit(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) {
        h(...args);
      }
    },
    connect: vi.fn(options.connect ?? (async () => {})),
    remoteParticipants: new Map(),
    localParticipant: { publishTrack: vi.fn(options.publishTrack ?? (async () => ({}))) },
    removeAllListeners: vi.fn(),
    disconnect: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
    canPlaybackAudio: true,
  };
  return { room, asRoom: room as unknown as Room };
}
