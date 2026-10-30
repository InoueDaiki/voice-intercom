// モバイル版の画像・動画・ファイルの整え方と、署名付き URL への PUT(client-core の MediaPreparer と
// SignedPut を、端末の API で作る)。
//
// - 画像(JPEG、PNG、WebP、HEIC): そのまま送る。1MB を超えたらサムネイル(JPEG、長い辺 480px)を作る。
//   読めない形式は、サムネイルも幅・高さも無しで送る。
// - 動画: 選ぶときに iOS のピッカーが互換の形式(H.264)に変換する。Android は元のまま送る
//   (端末での変換はまだ作っていない。設計メモの「モバイル版の画面」)。
//   0.5 秒目のコマからサムネイルを作る。読めなければ無しで送る。
// - それ以外: ファイルとして送る(ダウンロードだけになる)。
// 形式はファイルの先頭のバイトで見分ける(拡張子やピッカーの MIME 型は当てにならない)。
import {
  IMAGE_THUMBNAIL_THRESHOLD,
  MAX_UPLOAD_BYTES,
  type MediaPreparer,
  type MediaSize,
  type PreparedMedia,
  PutFailedError,
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

export const mobileMediaPreparer: MediaPreparer<PickedMedia, LocalFile> = {
  async prepare(source) {
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
      const probe = await videoThumbnail(source.uri);
      return {
        ...base,
        contentType: source.mimeType?.startsWith("video/") ? source.mimeType : "video/mp4",
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
