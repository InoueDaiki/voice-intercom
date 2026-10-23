// 画面の見え方と、画面を消させない仕組みの偽物(RoomKeeper と RoomHub のテスト)
import { vi } from "vitest";

import type { AppPresence, PresenceChange } from "../room/roomKeeper.ts";

// 見え方を手で変えられる AppPresence
export function fakePresence(visible = true) {
  const listeners = new Set<(change: PresenceChange) => void>();
  const presence: AppPresence = {
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    presence,
    change(change: PresenceChange) {
      visible = change !== "hidden" && (change === "visible" || visible);
      for (const l of [...listeners]) {
        l(change);
      }
    },
    listenerCount: () => listeners.size,
  };
}

// 持っているかだけを覚える ScreenAwake
export function fakeAwake() {
  const awake = { held: false, acquire: vi.fn(), release: vi.fn() };
  awake.acquire.mockImplementation(() => {
    awake.held = true;
  });
  awake.release.mockImplementation(() => {
    awake.held = false;
  });
  return awake;
}
