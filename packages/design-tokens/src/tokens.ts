// デザイントークンの正。ここを変えたら `mise run gen:tokens` で generated/ を作り直す。
// 色は役割の名前で持つ(「青」ではなく「主な操作」)。画面ではこの名前だけを使う。
// 明暗の両方の値を持ち、OS の設定(prefers-color-scheme)で切り替える。
import { oklch, type Oklch } from "./color.ts";

export interface ColorToken {
  light: Oklch;
  dark: Oklch;
  // 使う場面。generated/TOKENS.md に載せ、AI と人が名前を選ぶときの手がかりにする
  usage: string;
}

// 基調の色相。青緑(インカムの「通じている」色)。灰色もわずかにこの色相に寄せる
const BRAND = 192;
const GRAY = 215;

export const colors = {
  // ---- 地と面 ----
  canvas: {
    light: oklch(0.985, 0.004, GRAY),
    dark: oklch(0.17, 0.012, GRAY),
    usage: "ページの地(body)",
  },
  surface: {
    light: oklch(1, 0, 0),
    dark: oklch(0.215, 0.014, GRAY),
    usage: "カード、表、入力欄、ヘッダーなど、地の上に置く面",
  },
  "surface-muted": {
    light: oklch(0.96, 0.007, GRAY),
    dark: oklch(0.255, 0.015, GRAY),
    usage: "控えめな塗り(表の見出し、選んでいるナビ、コードの地)",
  },
  "surface-strong": {
    light: oklch(0.925, 0.01, GRAY),
    dark: oklch(0.305, 0.016, GRAY),
    usage: "控えめな塗りの上で押したとき・重ねたとき",
  },

  // ---- 文字と線 ----
  fg: {
    light: oklch(0.25, 0.02, GRAY),
    dark: oklch(0.94, 0.008, GRAY),
    usage: "本文の文字",
  },
  "fg-muted": {
    light: oklch(0.48, 0.02, GRAY),
    dark: oklch(0.72, 0.015, GRAY),
    usage: "補足の文字(時刻、件数、入力の説明)",
  },
  border: {
    light: oklch(0.9, 0.01, GRAY),
    dark: oklch(0.32, 0.016, GRAY),
    usage: "区切り線、カードと表の枠",
  },
  "border-strong": {
    light: oklch(0.64, 0.015, GRAY),
    dark: oklch(0.54, 0.018, GRAY),
    usage: "入力欄と、押せる部品の枠",
  },

  // ---- 主な操作(基調色) ----
  primary: {
    light: oklch(0.52, 0.085, BRAND),
    dark: oklch(0.74, 0.11, BRAND),
    usage: "主なボタンの塗り、フォーカスの輪、選んでいる状態",
  },
  "primary-hover": {
    light: oklch(0.46, 0.075, BRAND),
    dark: oklch(0.8, 0.1, BRAND),
    usage: "主なボタンにマウスを載せたとき",
  },
  "on-primary": {
    light: oklch(1, 0, 0),
    dark: oklch(0.18, 0.03, BRAND),
    usage: "primary の塗りの上の文字",
  },
  "primary-soft": {
    light: oklch(0.95, 0.03, BRAND),
    dark: oklch(0.3, 0.05, BRAND),
    usage: "基調色の淡い塗り(バッジ、知らせ)",
  },
  "primary-fg": {
    light: oklch(0.45, 0.075, BRAND),
    dark: oklch(0.8, 0.1, BRAND),
    usage: "基調色の文字(リンク、primary-soft の上の文字)",
  },

  // ---- 状態 ----
  danger: {
    light: oklch(0.54, 0.19, 27),
    dark: oklch(0.68, 0.17, 25),
    usage: "削除など取り返しのつかない操作の塗り、入力の誤りの枠",
  },
  "on-danger": {
    light: oklch(1, 0, 0),
    dark: oklch(0.18, 0.04, 25),
    usage: "danger の塗りの上の文字",
  },
  "danger-soft": {
    light: oklch(0.95, 0.025, 25),
    dark: oklch(0.29, 0.06, 25),
    usage: "誤り・失敗の淡い塗り",
  },
  "danger-fg": {
    light: oklch(0.48, 0.17, 27),
    dark: oklch(0.78, 0.12, 25),
    usage: "誤り・失敗の文字",
  },
  "warning-soft": {
    light: oklch(0.95, 0.05, 85),
    dark: oklch(0.3, 0.05, 75),
    usage: "注意の淡い塗り(音が止められている、モック API など)",
  },
  "warning-fg": {
    light: oklch(0.47, 0.1, 65),
    dark: oklch(0.83, 0.11, 80),
    usage: "注意の文字",
  },
  warning: {
    light: oklch(0.76, 0.15, 75),
    dark: oklch(0.78, 0.14, 75),
    usage: "注意の線(PTT を押したがまだ話せていない)",
  },
  "success-soft": {
    light: oklch(0.95, 0.04, 155),
    dark: oklch(0.29, 0.05, 155),
    usage: "成功の淡い塗り",
  },
  "success-fg": {
    light: oklch(0.45, 0.11, 155),
    dark: oklch(0.8, 0.12, 155),
    usage: "成功の文字(保存しました)",
  },

  // ---- 通話 ----
  live: {
    light: oklch(0.58, 0.2, 18),
    dark: oklch(0.58, 0.19, 18),
    usage: "送話中(PTT で声を送っている)の塗りと線",
  },
  "on-live": {
    light: oklch(1, 0, 0),
    dark: oklch(1, 0, 0),
    usage: "live の塗りの上の文字",
  },

  // ---- タイムラインの種類 ----
  "kind-voice": {
    light: oklch(0.62, 0.1, BRAND),
    dark: oklch(0.66, 0.1, BRAND),
    usage: "タイムラインの、音声の発話の印",
  },
  "kind-text": {
    light: oklch(0.62, 0.12, 155),
    dark: oklch(0.66, 0.12, 155),
    usage: "タイムラインの、テキスト入力の印",
  },
  "kind-media": {
    light: oklch(0.72, 0.14, 70),
    dark: oklch(0.74, 0.13, 70),
    usage: "タイムラインの、画像・動画・ファイルの印",
  },

  // ---- 重ね ----
  overlay: {
    light: oklch(0.2, 0.01, GRAY, 0.65),
    dark: oklch(0.1, 0.01, GRAY, 0.7),
    usage: "画像・動画に重ねる帯(動画の長さ)",
  },
  "on-overlay": {
    light: oklch(1, 0, 0),
    dark: oklch(1, 0, 0),
    usage: "overlay の上の文字",
  },
} satisfies Record<string, ColorToken>;

export type ColorName = keyof typeof colors;

// 文字と地の組み合わせ。コントラスト比をテストで確かめる(src/tokens.test.ts)。
// min は WCAG 2 の AA(本文 4.5、大きい文字と部品の線 3)
export const contrastPairs: { fg: ColorName; bg: ColorName; min: number }[] = [
  ...(["canvas", "surface", "surface-muted"] as const).flatMap((bg) => [
    { fg: "fg" as const, bg, min: 4.5 },
    { fg: "fg-muted" as const, bg, min: 4.5 },
    { fg: "primary-fg" as const, bg, min: 4.5 },
    { fg: "danger-fg" as const, bg, min: 4.5 },
    { fg: "success-fg" as const, bg, min: 4.5 },
    { fg: "warning-fg" as const, bg, min: 4.5 },
  ]),
  { fg: "on-primary", bg: "primary", min: 4.5 },
  { fg: "on-primary", bg: "primary-hover", min: 4.5 },
  { fg: "on-danger", bg: "danger", min: 4.5 },
  { fg: "on-live", bg: "live", min: 4.5 },
  { fg: "on-overlay", bg: "overlay", min: 4.5 },
  { fg: "primary-fg", bg: "primary-soft", min: 4.5 },
  { fg: "danger-fg", bg: "danger-soft", min: 4.5 },
  { fg: "warning-fg", bg: "warning-soft", min: 4.5 },
  { fg: "success-fg", bg: "success-soft", min: 4.5 },
  { fg: "fg", bg: "primary-soft", min: 4.5 },
  { fg: "fg", bg: "warning-soft", min: 4.5 },
  // 線と、押せる部品の見分け
  { fg: "border-strong", bg: "surface", min: 3 },
  { fg: "primary", bg: "canvas", min: 3 },
  { fg: "danger", bg: "surface", min: 3 },
  { fg: "live", bg: "surface", min: 3 },
];

// 角丸(rem)。Tailwind の rounded-sm / md / lg / xl になる
export const radius = {
  sm: 0.25,
  md: 0.5,
  lg: 0.75,
  xl: 1,
};

// 書体。React Native では端末の既定の書体を使う(ここの値は Web だけ)
export const fontFamily = {
  sans: 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
