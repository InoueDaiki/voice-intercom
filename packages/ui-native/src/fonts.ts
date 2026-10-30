// 書体(IBM Plex Sans JP)の名前。アプリが expo-font で埋め込む(apps/mobile/app.config.ts)。
// iOS は PostScript の名前、Android はファイルの名前で指す。太さごとに別の書体として指すので、
// fontWeight で太くしない(二重に太くならないよう 400 にする)
import { Platform, type TextStyle } from "react-native";

export type FontWeight = 400 | 500 | 700;

const families: Record<FontWeight, string> =
  Platform.OS === "ios"
    ? { 400: "IBMPlexSansJP-Regular", 500: "IBMPlexSansJP-Medium", 700: "IBMPlexSansJP-Bold" }
    : { 400: "IBMPlexSansJP_400Regular", 500: "IBMPlexSansJP_500Medium", 700: "IBMPlexSansJP_700Bold" };

export function fontStyle(weight: FontWeight): TextStyle {
  return {
    fontFamily: families[weight],
    fontWeight: "400",
    // 数字の幅をそろえる(時刻・人数・進み具合が動いても横にずれない)
    fontVariant: ["tabular-nums"],
  };
}

// クラスから太さを読む。書いていなければ undefined
export function weightOfClass(className: string | undefined): FontWeight | undefined {
  if (!className) {
    return undefined;
  }
  if (/(?:^|\s)font-bold(?:\s|$)/.test(className)) {
    return 700;
  }
  if (/(?:^|\s)font-medium(?:\s|$)/.test(className)) {
    return 500;
  }
  return /(?:^|\s)font-normal(?:\s|$)/.test(className) ? 400 : undefined;
}
