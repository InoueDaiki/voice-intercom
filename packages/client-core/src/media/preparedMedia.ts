// 送る形に整えた画像・動画・ファイルと、整える処理(端末に依るので各アプリが差し込む)。

// 本体の上限(10GB。API の CreateMediaUploadRequest の size_bytes の上限と合わせる。
// 大きなものはマルチパートで上げる)。動画の長さには上限を設けない
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

// 画像のサムネイルを作る大きさの境目(設計メモの「サムネイル」の例)
export const IMAGE_THUMBNAIL_THRESHOLD = 1024 * 1024;

// サムネイルの長い辺のピクセル数
export const THUMBNAIL_MAX_SIDE = 480;

// 幅・高さの上限(API の CreateMediaUploadRequest の width・height の上限)
export const MAX_MEDIA_SIDE = 65535;

// 動画の長さの上限(API の CreateMediaUploadRequest の duration_ms の上限。24時間)
export const MAX_MEDIA_DURATION_MS = 24 * 60 * 60 * 1000;

// 表示の幅と高さ(ピクセル。向きを反映した後。縦向きなら height が大きい)
export interface MediaSize {
  width: number;
  height: number;
}

// API が受け付ける幅・高さなら返す(どちらかが無いか範囲の外なら undefined。送らない)
export function validSize(width: number | undefined, height: number | undefined): MediaSize | undefined {
  const ok = (v: number | undefined): v is number =>
    v !== undefined && Number.isInteger(v) && v >= 1 && v <= MAX_MEDIA_SIDE;
  return ok(width) && ok(height) ? { width, height } : undefined;
}

// API が受け付ける動画の長さ(ミリ秒)にする。分からないか範囲の外なら undefined(送らない)
export function validDurationMs(ms: number | undefined): number | undefined {
  if (ms === undefined || !Number.isFinite(ms)) {
    return undefined;
  }
  const rounded = Math.round(ms);
  return rounded >= 1 && rounded <= MAX_MEDIA_DURATION_MS ? rounded : undefined;
}

// 送る形に整えた画像・動画・ファイル。F は本体を指すもの(Web 版は Blob、React Native はファイルのパスなど)
export interface PreparedMedia<F> {
  file: F;
  // uploads に渡す content_type。image/jpeg、image/png、image/webp、image/heic は画像、
  // video/* は動画、それ以外はファイル(ダウンロードだけ)
  contentType: string;
  // 元のファイル名(ファイルのダウンロードの名前と表示に使う)
  fileName?: string;
  sizeBytes: number;
  isVideo: boolean;
  // サムネイル(image/jpeg)。無ければ undefined
  thumbnail?: Uint8Array;
  // 整えた後の本体の表示の大きさ(向きを反映した後)。測れなければ undefined
  size?: MediaSize;
  // 動画の長さ(ミリ秒)。画像と、分からないときは undefined
  durationMs?: number;
}

// 送れないもの(大きさなど)。やり直しても同じなので、やり直させない。
export class UnsupportedMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedMediaError";
  }
}

// 選んだもの(S)を、送る形(JPEG などの画像、MP4 の動画)に整え、サムネイルを作る。
export interface MediaPreparer<S, F> {
  // onProgress は 0〜1(動画の変換の進み具合)
  prepare(source: S, onProgress?: (progress: number) => void): Promise<PreparedMedia<F>>;
  // 送り終えたか諦めたときに呼ぶ(整えるときに作った一時ファイルを消す)
  release?(media: PreparedMedia<F>): Promise<void>;
}
