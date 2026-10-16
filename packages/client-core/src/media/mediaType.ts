// 選んだファイルの中身の形式。拡張子やピッカーの MIME 型は当てにならない
// (iOS で HEIC を JPEG にしたのに拡張子が残る、Android で MIME 型が無い、など)ので、
// 先頭のバイトで見分ける。
export type SniffedType = "jpeg" | "png" | "webp" | "heic" | "gif" | "video" | "unknown";

export const SNIFFED_MIME: Record<SniffedType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  gif: "image/gif",
  // MP4 / MOV などの動画
  video: "video/*",
  unknown: "application/octet-stream",
};

export function isImage(t: SniffedType): boolean {
  return t !== "video" && t !== "unknown";
}

// API がそのまま受け付ける画像(uploads の content_type)
export function uploadableAsIs(t: SniffedType): boolean {
  return t === "jpeg" || t === "png" || t === "webp" || t === "heic";
}

// 判定に要る先頭のバイト数
export const SNIFF_LENGTH = 16;

// 先頭のバイトから形式を見分ける。
export function sniffMediaType(head: Uint8Array): SniffedType {
  const at = (offset: number, bytes: number[] | string): boolean => {
    const list = typeof bytes === "string" ? [...bytes].map((c) => c.charCodeAt(0)) : bytes;
    if (head.length < offset + list.length) {
      return false;
    }
    return list.every((b, i) => head[offset + i] === b);
  };
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));

  if (at(0, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (at(0, "RIFF") && at(8, "WEBP")) {
    return "webp";
  }
  if (at(0, "GIF8")) {
    return "gif";
  }
  // ISO BMFF(MP4、MOV、HEIC)は 4 バイト目から "ftyp" と主ブランドが続く
  if (at(4, "ftyp") && head.length >= 12) {
    return HEIF_BRANDS.has(ascii(8, 12)) ? "heic" : "video";
  }
  // 古い MOV には ftyp がなく、moov / mdat / wide などの箱から始まるものがある
  if (head.length >= 8 && OLD_MOV_BOXES.has(ascii(4, 8))) {
    return "video";
  }
  return "unknown";
}

// HEIF の静止画のブランド(avif は API が受け付けないので含めない)
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "mif1", "msf1"]);
const OLD_MOV_BOXES = new Set(["moov", "mdat", "wide", "free", "skip"]);
