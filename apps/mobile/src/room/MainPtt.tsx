import type { RoomHub } from "@voice-intercom/client-core";
import { mainPttState, pressAll } from "@voice-intercom/client-react";
import { PttButton } from "@voice-intercom/ui-native";

// 音声をつないだ全部のルームに届く PTT。押している間だけ話す
export function MainPtt({ hub, className }: { hub: RoomHub; className?: string }) {
  const { state, label, connected } = mainPttState(hub);
  return (
    <PttButton
      className={className}
      state={state}
      disabled={!connected}
      accessibilityHint="押している間、声が届きます"
      onPressIn={() => pressAll(hub, true)}
      onPressOut={() => pressAll(hub, false)}
    >
      {label}
    </PttButton>
  );
}
