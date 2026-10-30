import type { Observable } from "@voice-intercom/client-core";
import { useSyncExternalStore } from "react";

// client-core の状態(RoomSession など)が変わったら描き直す。返すのは変わった回数
export function useObservable(target: Observable | undefined): number {
  return useSyncExternalStore(target?.subscribe ?? noopSubscribe, target?.getVersion ?? zero);
}

const noopSubscribe = () => () => {};
const zero = () => 0;
