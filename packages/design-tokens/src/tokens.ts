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

// 色の考え方は無線機・放送卓のキーと表示灯から取る。
// - 主な操作は「点灯したキー」の琥珀色。押すと灯るキーのように、画面の主な操作だけを灯す
// - 送話(TX)は赤、受信(RX)は緑。無線機の表示灯と同じ意味で、ほかの用途には使わない
// - 地と文字は、わずかに青に寄せたグラファイト
const AMBER = 72;
const GRAPHITE = 255;

export const colors = {
  // ---- 地と面 ----
  canvas: {
    light: oklch(0.962, 0.004, GRAPHITE),
    dark: oklch(0.185, 0.012, GRAPHITE),
    usage: "ページの地(body)",
  },
  surface: {
    light: oklch(1, 0, 0),
    dark: oklch(0.225, 0.014, GRAPHITE),
    usage: "表、入力欄、ヘッダー、操作の台など、地の上に置く面",
  },
  "surface-muted": {
    light: oklch(0.942, 0.006, GRAPHITE),
    dark: oklch(0.262, 0.015, GRAPHITE),
    usage: "控えめな塗り(表の見出し、マウスを載せた行、コードの地)",
  },
  "surface-strong": {
    light: oklch(0.905, 0.008, GRAPHITE),
    dark: oklch(0.31, 0.016, GRAPHITE),
    usage: "控えめな塗りの上で押したとき・重ねたとき",
  },

  // ---- 文字と線 ----
  fg: {
    light: oklch(0.235, 0.018, GRAPHITE),
    dark: oklch(0.945, 0.006, GRAPHITE),
    usage: "本文の文字。フォーカスの輪",
  },
  "fg-muted": {
    light: oklch(0.47, 0.016, GRAPHITE),
    dark: oklch(0.72, 0.014, GRAPHITE),
    usage: "補足の文字(時刻、件数、入力の説明、字幕の原文)",
  },
  border: {
    light: oklch(0.885, 0.007, GRAPHITE),
    dark: oklch(0.32, 0.016, GRAPHITE),
    usage: "区切り線、面と表の枠",
  },
  "border-strong": {
    light: oklch(0.6, 0.014, GRAPHITE),
    dark: oklch(0.54, 0.016, GRAPHITE),
    usage: "入力欄と、押せる部品の枠",
  },

  // ---- 主な操作(点灯したキー) ----
  primary: {
    light: oklch(0.8, 0.15, AMBER),
    dark: oklch(0.8, 0.145, AMBER),
    usage: "主なボタンの塗り、選んでいる印、PTT を押して準備している間の灯り",
  },
  "primary-hover": {
    light: oklch(0.75, 0.15, AMBER - 4),
    dark: oklch(0.85, 0.13, AMBER + 6),
    usage: "主なボタンにマウスを載せたとき",
  },
  "on-primary": {
    light: oklch(0.22, 0.03, AMBER - 12),
    dark: oklch(0.2, 0.03, AMBER - 12),
    usage: "primary の塗りの上の文字",
  },
  "primary-soft": {
    light: oklch(0.955, 0.035, AMBER + 10),
    dark: oklch(0.3, 0.055, AMBER),
    usage: "基調色の淡い塗り(札、知らせ、選んでいるナビ)",
  },
  "primary-fg": {
    light: oklch(0.47, 0.105, AMBER - 12),
    dark: oklch(0.84, 0.12, AMBER + 8),
    usage: "基調色の文字(primary-soft の上の文字)",
  },

  // ---- キー(PTT の面) ----
  key: {
    light: oklch(0.27, 0.018, GRAPHITE),
    dark: oklch(0.36, 0.018, GRAPHITE),
    usage: "押して使う大きなキーの面(PTT を押していないとき)",
  },
  "on-key": {
    light: oklch(0.97, 0.004, GRAPHITE),
    dark: oklch(0.97, 0.004, GRAPHITE),
    usage: "key の面の上の文字",
  },
  "key-hover": {
    light: oklch(0.33, 0.02, GRAPHITE),
    dark: oklch(0.41, 0.02, GRAPHITE),
    usage: "key の面にマウスを載せたとき",
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
    light: oklch(0.945, 0.032, 55),
    dark: oklch(0.29, 0.05, 50),
    usage: "注意の淡い塗り(音が止められている、モック API など)",
  },
  "warning-fg": {
    light: oklch(0.47, 0.11, 45),
    dark: oklch(0.83, 0.1, 55),
    usage: "注意の文字",
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

  // ---- 通話の表示灯 ----
  live: {
    light: oklch(0.565, 0.205, 25),
    dark: oklch(0.57, 0.2, 25),
    usage: "送話(TX)。自分が PTT で声を送っている間の塗りと灯り",
  },
  "on-live": {
    light: oklch(1, 0, 0),
    dark: oklch(1, 0, 0),
    usage: "live の塗りの上の文字",
  },
  rx: {
    light: oklch(0.64, 0.16, 150),
    dark: oklch(0.74, 0.16, 150),
    usage: "受信(RX)の灯り。ほかの人が話している間",
  },
  "rx-soft": {
    light: oklch(0.955, 0.04, 150),
    dark: oklch(0.27, 0.045, 150),
    usage: "受信中の字幕の帯の塗り",
  },
  "rx-fg": {
    light: oklch(0.43, 0.1, 150),
    dark: oklch(0.82, 0.12, 150),
    usage: "受信の文字(受信中の帯の見出し)",
  },

  // ---- 重ね ----
  overlay: {
    light: oklch(0.2, 0.01, GRAPHITE, 0.65),
    dark: oklch(0.1, 0.01, GRAPHITE, 0.7),
    usage: "画像・動画に重ねる帯(動画の長さ)、ダイアログの後ろに敷く幕",
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
  { fg: "on-key", bg: "key", min: 4.5 },
  { fg: "on-key", bg: "key-hover", min: 4.5 },
  { fg: "on-danger", bg: "danger", min: 4.5 },
  { fg: "on-live", bg: "live", min: 4.5 },
  { fg: "on-overlay", bg: "overlay", min: 4.5 },
  { fg: "primary-fg", bg: "primary-soft", min: 4.5 },
  { fg: "danger-fg", bg: "danger-soft", min: 4.5 },
  { fg: "warning-fg", bg: "warning-soft", min: 4.5 },
  { fg: "success-fg", bg: "success-soft", min: 4.5 },
  { fg: "rx-fg", bg: "rx-soft", min: 4.5 },
  { fg: "fg", bg: "rx-soft", min: 4.5 },
  { fg: "fg", bg: "primary-soft", min: 4.5 },
  { fg: "fg", bg: "warning-soft", min: 4.5 },
  // 線と、押せる部品の見分け
  { fg: "border-strong", bg: "surface", min: 3 },
  // 琥珀のキーは地との明るさの差が小さいので、塗りの上の文字(on-primary)で見分ける。
  // 選んでいる印などの線には primary-fg を使う。フォーカスの輪は fg(地の上に出る)
  { fg: "primary-fg", bg: "surface", min: 3 },
  { fg: "danger", bg: "surface", min: 3 },
  { fg: "live", bg: "surface", min: 3 },
  // key は暗い配色では地との差を小さくしてある(浮いたキー)。キーは上の文字(on-key)で見分ける
];

// 角丸(rem)。Tailwind の rounded-sm / md / lg / xl になる
// 大きさで役割を分ける: sm は札とコード、md はボタンと入力欄、lg は面と表、xl は PTT のキー
export const radius = {
  sm: 0.1875,
  md: 0.375,
  lg: 0.625,
  xl: 1,
};

// 書体。IBM Plex Sans JP の1つに絞る(機器の表示のような、組み立てた感じの形で、和文と欧文がそろう)。
// Web は @fontsource/ibm-plex-sans-jp を ui-web の styles.css で読み込む。
// React Native では、モバイル版を作るときに同じ書体を組み込む(それまでは端末の既定の書体)
export const fontFamily = {
  sans: '"IBM Plex Sans JP", system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
