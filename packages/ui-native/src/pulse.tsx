import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";

// 灯りの明滅(Web の motion-safe:animate-pulse)。OS で動きを減らす設定なら明滅しない
export function Pulse({ active, children }: { active: boolean; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, opacity]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
