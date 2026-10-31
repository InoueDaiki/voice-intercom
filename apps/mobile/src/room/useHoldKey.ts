import { useEffect, useRef } from "react";

// 押している間だけ話すキーの、押す・離す。押したままキーが消えたら(画面を移った、音声を切った)、
// onPressOut は届かないので、ここで離す(Web 版の AudioDock の useHoldKey と同じ)
export function useHoldKey(press: (value: boolean) => void) {
  const held = useRef<() => void>(undefined);
  // 最後に押したときの press で離す(押している間に hub が替わっても、押した先を離す)
  useEffect(() => () => held.current?.(), []);
  return {
    down: () => {
      held.current = () => press(false);
      press(true);
    },
    up: () => {
      held.current?.();
      held.current = undefined;
    },
  };
}
