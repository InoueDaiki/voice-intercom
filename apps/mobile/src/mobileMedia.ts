// モバイル版の画像・動画・ファイルの整え方と、署名付き URL への PUT(client-core の MediaPreparer と
// SignedPut を、端末の API で作る)。
//
// - 画像(JPEG、PNG、WebP、HEIC): そのまま送る。1MB を超えたらサムネイル(JPEG、長い辺 480px)を作る。
//   読めない形式は、サムネイルも幅・高さも無しで送る。
// - 動画: iOS は選ぶときにピッカーが互換の形式(H.264)に変換する。Android は Web 版と同じ決め方(planVideo)で、
//   H.264 の MP4 に整えてから送る(video-transcode。変換できなければ元のまま送る)。
//   ネイティブの変換は同時に1つだけなので、ルームをまたいで1つずつ順に行う(transcodeInTurn)。
//   0.5 秒目のコマからサムネイルを作る。読めなければ無しで送る。
// - それ以外: ファイルとして送る(ダウンロードだけになる)。
// 形式はファイルの先頭のバイトで見分ける(拡張子やピッカーの MIME 型は当てにならない)。
import {
  estimateTranscodedBytes,
  IMAGE_THUMBNAIL_THRESHOLD,
  MAX_UPLOAD_BYTES,
  type MediaPreparer,
  type MediaSize,
  type PreparedMedia,
  planVideo,
  PutFailedError,
  readMp4Layout,
  type SignedPut,
  SNIFF_LENGTH,
  SNIFFED_MIME,
  sniffMediaType,
  THUMBNAIL_MAX_SIDE,
  UnsupportedMediaError,
  uploadableAsIs,
  validDurationMs,
  validSize,
} from "@voice-intercom/client-core";
import { videoTranscode } from "@voice-intercom/video-transcode";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { getThumbnailAsync } from "expo-video-thumbnails";

// ピッカーで選んだもの
export interface PickedMedia {
  uri: string;
  name: string;
  mimeType?: string;
  // 動画の長さ(ミリ秒)
  durationMs?: number;
  // 動画の幅と高さ(ピッカーが返したもの)
  width?: number;
  height?: number;
}

// 本体を指すもの
export interface LocalFile {
  uri: string;
  // 変換して作った一時ファイルなら true(送り終えたら消す)
  temporary?: boolean;
}

const JPEG_QUALITY = 0.8;
// 動画のサムネイルにするコマ(ミリ秒)。真っ黒な先頭のコマを避ける
const VIDEO_THUMBNAIL_AT_MS = 500;

async function readRange(uri: string, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const handle = new File(uri).open();
  try {
    handle.offset = offset;
    return await handle.readBytes(length);
  } finally {
    handle.close();
  }
}

// 長い辺を THUMBNAIL_MAX_SIDE にした JPEG。向きは反映される
async function thumbnailOf(uri: string, width: number, height: number): Promise<Uint8Array | undefined> {
  const landscape = width >= height;
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > THUMBNAIL_MAX_SIDE) {
    context.resize(landscape ? { width: THUMBNAIL_MAX_SIDE } : { height: THUMBNAIL_MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  const file = new File(saved.uri);
  try {
    return await file.bytes();
  } finally {
    file.delete();
  }
}

async function probeImage(uri: string, withThumbnail: boolean): Promise<{ size?: MediaSize; thumbnail?: Uint8Array } | undefined> {
  try {
    const image = await ImageManipulator.manipulate(uri).renderAsync();
    const { width, height } = image;
    return {
      size: validSize(width, height),
      thumbnail: withThumbnail ? await thumbnailOf(uri, width, height) : undefined,
    };
  } catch (e) {
    console.info("画像を読めなかった", e);
    return undefined;
  }
}

async function videoThumbnail(uri: string): Promise<{ size?: MediaSize; thumbnail?: Uint8Array } | undefined> {
  try {
    const frame = await getThumbnailAsync(uri, { time: VIDEO_THUMBNAIL_AT_MS });
    const thumbnail = await thumbnailOf(frame.uri, frame.width, frame.height);
    new File(frame.uri).delete();
    return { size: validSize(frame.width, frame.height), thumbnail };
  } catch (e) {
    console.info("動画のコマを読めなかった", e);
    return undefined;
  }
}

function abortReason(signal: AbortSignal): unknown {
  // React Native の AbortSignal には reason が無い
  return signal.reason ?? new Error("取りやめた");
}

// 最後に並んだ変換が終わると解決する。失敗でも解決するので、次の変換は止まらない
let lastTranscode: Promise<void> = Promise.resolve();

// 変換を1つずつ順に行う。MediaUploader はルームごとにあるので、アプリ全体で1つの列にする。
// 順番を待っている間に取りやめたら、すぐに列から抜ける(動いている別の変換には触らない)
function transcodeInTurn<T>(task: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  const previous = lastTranscode;
  let finished!: () => void;
  lastTranscode = new Promise((resolve) => {
    finished = resolve;
  });
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => signal && reject(abortReason(signal));
    signal?.addEventListener("abort", onAbort, { once: true });
    void previous.then(async () => {
      signal?.removeEventListener("abort", onAbort);
      try {
        if (signal?.aborted) {
          reject(abortReason(signal));
        } else {
          resolve(await task());
        }
      } catch (e) {
        reject(e);
      } finally {
        finished();
      }
    });
  });
}

// 動画を整える(Android)。整えなくてよいか、整えられなければ undefined(元のまま送る)
async function convertVideo(
  uri: string,
  sizeBytes: number,
  onProgress: ((progress: number) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (!videoTranscode) {
    return undefined;
  }
  const native = videoTranscode;
  let plan: ReturnType<typeof planVideo>;
  try {
    const probe = await native.probe(uri);
    const size = validSize(probe.width, probe.height);
    if (!size) {
      return undefined;
    }
    const full = { ...probe, ...size };
    const layout = await readMp4Layout((offset, length) => readRange(uri, offset, length), sizeBytes);
    plan = planVideo(full, layout);
    console.info("動画の整え方", plan, full);
    if (plan.kind === "asIs") {
      return undefined;
    }
    if (plan.kind === "transcode" && (estimateTranscodedBytes(full, plan.videoBitrate) ?? 0) > MAX_UPLOAD_BYTES) {
      throw new UnsupportedMediaError("変換すると 10GB を超えそうなので送れない");
    }
  } catch (e) {
    if (e instanceof UnsupportedMediaError) {
      throw e;
    }
    console.warn("動画を読めないので、元のまま送る", e);
    return undefined;
  }
  // 測っている間に取りやめたら、変換を始めない(ここより前は abort の listener が付いていない)
  if (signal?.aborted) {
    throw abortReason(signal);
  }
  const videoBitrate = plan.kind === "transcode" ? plan.videoBitrate : null;
  try {
    return await transcodeInTurn(async () => {
      // 進み具合と取りやめは、ネイティブに1つしかない変換に向かうので、自分の番の間だけつなぐ
      const progress = native.addListener("onProgress", (e) => onProgress?.(e.progress));
      const onAbort = () => void native.cancel();
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const path = await native.transcode(uri, videoBitrate);
        return path.startsWith("file:") ? path : `file://${path}`;
      } finally {
        progress.remove();
        signal?.removeEventListener("abort", onAbort);
      }
    }, signal);
  } catch (e) {
    if (signal?.aborted) {
      throw e;
    }
    // 列の外で変換が動いている(開発中に JS を読み込み直したときなど)。動画の問題ではないので、元のまま送らず、
    // 失敗として見せてやり直してもらう
    if ((e as { code?: unknown }).code === "ERR_TRANSCODE_BUSY") {
      throw new Error("別の動画を変換している", { cause: e });
    }
    console.warn("動画を変換できなかったので、元のまま送る", e);
    return undefined;
  }
}

export const mobileMediaPreparer: MediaPreparer<PickedMedia, LocalFile> = {
  async prepare(source, onProgress, signal) {
    const sizeBytes = new File(source.uri).size;
    if (sizeBytes === 0) {
      throw new UnsupportedMediaError("空のファイルは送れない");
    }
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      throw new UnsupportedMediaError("10GB を超えるので送れない");
    }
    const sniffed = sniffMediaType(await readRange(source.uri, 0, SNIFF_LENGTH));
    const base = { file: { uri: source.uri }, sizeBytes, fileName: source.name || undefined };

    if (uploadableAsIs(sniffed)) {
      const probe = await probeImage(source.uri, sizeBytes > IMAGE_THUMBNAIL_THRESHOLD);
      return { ...base, contentType: SNIFFED_MIME[sniffed], isVideo: false, size: probe?.size, thumbnail: probe?.thumbnail };
    }
    if (sniffed === "video") {
      const converted = await convertVideo(source.uri, sizeBytes, onProgress, signal);
      const uri = converted ?? source.uri;
      const probe = await videoThumbnail(uri);
      return {
        ...base,
        file: { uri, temporary: converted !== undefined },
        sizeBytes: converted ? new File(uri).size : sizeBytes,
        // 変換したら拡張子を .mp4 にする(IMG_0001.MOV → IMG_0001.mp4)
        fileName: converted && source.name ? source.name.replace(/(\.[^./]*)?$/, ".mp4") : base.fileName,
        contentType: converted ? "video/mp4" : source.mimeType?.startsWith("video/") ? source.mimeType : "video/mp4",
        isVideo: true,
        size: probe?.size ?? validSize(source.width, source.height),
        durationMs: validDurationMs(source.durationMs),
        thumbnail: probe?.thumbnail,
      };
    }
    // GIF なども含め、画像・動画として扱わないものはファイル
    return {
      ...base,
      contentType: source.mimeType && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(source.mimeType) ? source.mimeType : "application/octet-stream",
      isVideo: false,
    } satisfies PreparedMedia<LocalFile>;
  },

  // 変換して作った一時ファイルを消す
  async release(media) {
    if (media.file.temporary) {
      new File(media.file.uri).delete();
    }
  },
};

// 署名付き URL への PUT。送った量を知るため fetch ではなく XMLHttpRequest を使う。
// 本体はその範囲だけをメモリーに読んで送る(16MB 以上はマルチパートなので、大きな動画でも1回分はパートの大きさで済む)
export const xhrSignedPut: SignedPut<LocalFile> = {
  async putFile(url, file, { offset, length, contentType, contentDisposition, onProgress, signal }) {
    const bytes = await readRange(file.uri, offset, length);
    return put(url, bytes, { contentType, contentDisposition, onProgress, signal });
  },
  async putBytes(url, bytes, contentType) {
    await put(url, bytes, { contentType });
  },
};

function put(
  url: string,
  bytes: Uint8Array,
  options: {
    contentType?: string;
    contentDisposition?: string;
    onProgress?: (sent: number) => void;
    signal?: AbortSignal;
  },
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const xhr = new XMLHttpRequest();
    // 取りやめたら送るのをやめる
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", onAbort);
    xhr.onabort = () => reject(signal?.reason ?? new Error("取りやめた"));
    xhr.open("PUT", url);
    // 署名に入っているので、uploads に渡したものと同じにする。パート(contentType が undefined)は署名に
    // 入っていないが、Android の React Native は本体に Content-Type が無いと送らないので付ける
    xhr.setRequestHeader("Content-Type", options.contentType ?? "application/octet-stream");
    if (options.contentDisposition) {
      xhr.setRequestHeader("Content-Disposition", options.contentDisposition);
    }
    xhr.upload.onprogress = (e) => options.onProgress?.(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // マルチパートの complete に渡す
        resolve(xhr.getResponseHeader("ETag") ?? undefined);
      } else {
        reject(new PutFailedError(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error("通信に失敗した"));
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    xhr.send(body);
  });
}
