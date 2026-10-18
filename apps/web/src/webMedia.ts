// ブラウザでの画像・動画・ファイルの整え方と、署名付き URL への PUT(client-core の MediaPreparer と
// SignedPut を、ブラウザの API で作る)。
//
// - 画像(JPEG、PNG、WebP、HEIC): そのまま送る。1MB を超えたらサムネイル(JPEG、長い辺 480px)を作る。
//   幅・高さは createImageBitmap で測る(EXIF の向きを反映した後)。ブラウザが読めない形式(多くの
//   ブラウザの HEIC)は、サムネイルも幅・高さも無しで送る。
// - 動画: WebCodecs で H.264 の MP4 にしてから送る(video/videoConverter.ts。設計メモの「Web 版の動画の
//   変換」)。変換できないブラウザ・動画は元のまま送る。<video> で整えた後の長さと幅・高さを測り、
//   0.5 秒目のコマからサムネイルを作る。読めなければ無しで送る。
// - それ以外: ファイルとして送る(ダウンロードだけになる)。形式は問わない。
// 形式はファイルの先頭のバイトで見分ける(拡張子や File.type は当てにならない)。
import {
  IMAGE_THUMBNAIL_THRESHOLD,
  MAX_UPLOAD_BYTES,
  type MediaPreparer,
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
  type MediaSize,
} from "@voice-intercom/client-core";

import { convertVideo, releaseConvertedVideo } from "./video/videoConverter.ts";

// 動画の長さとコマを読むのを待つ長さ(ミリ秒)。読めなければサムネイル無しで送る
const VIDEO_PROBE_TIMEOUT_MS = 10_000;

export const webMediaPreparer: MediaPreparer<File, Blob> = {
  async prepare(file, onProgress, signal) {
    if (file.size === 0) {
      throw new UnsupportedMediaError("空のファイルは送れない");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new UnsupportedMediaError("10GB を超えるので送れない");
    }
    const head = new Uint8Array(await file.slice(0, SNIFF_LENGTH).arrayBuffer());
    const sniffed = sniffMediaType(head);
    const base = { file, sizeBytes: file.size, fileName: file.name || undefined };

    if (uploadableAsIs(sniffed)) {
      const probe = await probeImage(file, file.size > IMAGE_THUMBNAIL_THRESHOLD);
      return {
        ...base,
        contentType: SNIFFED_MIME[sniffed],
        isVideo: false,
        size: probe?.size,
        thumbnail: probe?.thumbnail,
      };
    }
    if (sniffed === "video") {
      const mp4 = await convertVideo(file, { onProgress, signal });
      const body = mp4 ?? file;
      try {
        const probe = await probeVideo(body);
        return {
          file: body,
          sizeBytes: body.size,
          // 変換したら拡張子を .mp4 にする(IMG_0001.MOV → IMG_0001.mp4)
          fileName: mp4 && file.name ? file.name.replace(/(\.[^./]*)?$/, ".mp4") : base.fileName,
          // 元のまま送るなら、ブラウザが付けた形式(MOV なら video/quicktime)をそのまま使う
          contentType: mp4 ? "video/mp4" : file.type.startsWith("video/") ? file.type : "video/mp4",
          isVideo: true,
          size: probe?.size,
          durationMs: probe?.durationMs,
          thumbnail: probe?.thumbnail,
        };
      } catch (e) {
        if (mp4) {
          await releaseConvertedVideo(mp4).catch(() => {});
        }
        throw e;
      }
    }
    // GIF なども含め、画像・動画として扱わないものはファイル
    return {
      ...base,
      contentType: file.type && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(file.type) ? file.type : "application/octet-stream",
      isVideo: false,
    } satisfies PreparedMedia<Blob>;
  },

  // 変換して作った一時ファイル(OPFS)を消す
  async release(media) {
    await releaseConvertedVideo(media.file);
  },
};

async function probeImage(file: File, withThumbnail: boolean): Promise<{ size?: MediaSize; thumbnail?: Uint8Array } | undefined> {
  let bitmap: ImageBitmap;
  try {
    // 既定で EXIF の向きを反映する(imageOrientation: "from-image")
    bitmap = await createImageBitmap(file);
  } catch {
    return undefined;
  }
  try {
    return {
      size: validSize(bitmap.width, bitmap.height),
      thumbnail: withThumbnail ? await thumbnailOf(bitmap, bitmap.width, bitmap.height) : undefined,
    };
  } finally {
    bitmap.close();
  }
}

async function probeVideo(
  file: File,
): Promise<{ size?: MediaSize; durationMs?: number; thumbnail?: Uint8Array } | undefined> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    video.src = url;
    await waitFor(video, "loadeddata");
    const size = validSize(video.videoWidth, video.videoHeight);
    const durationMs = validDurationMs(video.duration * 1000);
    let thumbnail: Uint8Array | undefined;
    try {
      // 真っ黒な先頭のコマを避け、少し進めたところを使う
      video.currentTime = Math.min(0.5, Number.isFinite(video.duration) ? video.duration / 2 : 0);
      await waitFor(video, "seeked");
      thumbnail = await thumbnailOf(video, video.videoWidth, video.videoHeight);
    } catch {
      thumbnail = undefined;
    }
    return { size, durationMs, thumbnail };
  } catch {
    return undefined;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function waitFor(video: HTMLVideoElement, event: "loadeddata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("時間切れ")), VIDEO_PROBE_TIMEOUT_MS);
    const done = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener("error", ng);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const ok = () => done();
    const ng = () => done(new Error("読めない"));
    video.addEventListener(event, ok);
    video.addEventListener("error", ng);
  });
}

// 長い辺を THUMBNAIL_MAX_SIDE にした JPEG
async function thumbnailOf(source: CanvasImageSource, width: number, height: number): Promise<Uint8Array | undefined> {
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return undefined;
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
}

// 署名付き URL への PUT。送った量を知るため fetch ではなく XMLHttpRequest を使う
// (fetch はアップロードの進み具合を取れない)。本体は Blob.slice でその範囲だけを送る
export const xhrSignedPut: SignedPut<Blob> = {
  putFile(url, file, { offset, length, contentType, contentDisposition, onProgress, signal }) {
    return put(url, file.slice(offset, offset + length), { contentType, contentDisposition, onProgress, signal });
  },
  async putBytes(url, bytes, contentType) {
    await put(url, new Blob([bytes as Uint8Array<ArrayBuffer>]), { contentType });
  },
};

function put(
  url: string,
  body: Blob,
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
    // 署名に入っているので、uploads に渡したものと同じにする(charset なども付けない)。
    // パート(contentType が undefined)には付けない。Blob.slice した本体は type が空なので、
    // ブラウザも Content-Type を付けない
    if (options.contentType) {
      xhr.setRequestHeader("Content-Type", options.contentType);
    }
    if (options.contentDisposition) {
      xhr.setRequestHeader("Content-Disposition", options.contentDisposition);
    }
    xhr.upload.onprogress = (e) => options.onProgress?.(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // マルチパートの complete に渡す。S3 の CORS で ETag を読めるようにしてある
        resolve(xhr.getResponseHeader("ETag") ?? undefined);
      } else {
        reject(new PutFailedError(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error("通信に失敗した"));
    xhr.send(body);
  });
}
