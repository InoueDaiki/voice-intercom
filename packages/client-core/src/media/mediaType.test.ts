import { expect, test } from "vitest";

import { sniffMediaType, uploadableAsIs } from "./mediaType.ts";

function bytes(head: number[], ascii = ""): Uint8Array {
  return Uint8Array.from([...head, ...[...ascii].map((c) => c.charCodeAt(0))]);
}

// ISO BMFF の先頭(箱の大きさ + "ftyp" + 主ブランド)
function ftyp(brand: string): Uint8Array {
  return bytes([0, 0, 0, 0x18], `ftyp${brand}\0\0\0\0`);
}

test("画像の形式を先頭のバイトで見分ける", () => {
  expect(sniffMediaType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
  expect(sniffMediaType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
  expect(sniffMediaType(bytes([], "RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
  expect(sniffMediaType(bytes([], "GIF89a"))).toBe("gif");
});

test("ftyp のブランドで HEIC と動画を分ける", () => {
  expect(sniffMediaType(ftyp("heic"))).toBe("heic");
  expect(sniffMediaType(ftyp("mif1"))).toBe("heic");
  expect(sniffMediaType(ftyp("isom"))).toBe("video");
  expect(sniffMediaType(ftyp("mp42"))).toBe("video");
  // iPhone の MOV
  expect(sniffMediaType(ftyp("qt  "))).toBe("video");
});

test("ftyp の無い古い MOV も動画にする", () => {
  expect(sniffMediaType(bytes([0, 0, 0, 8], "wide\0\0\0\0"))).toBe("video");
});

test("分からないものと短すぎるものは unknown", () => {
  expect(sniffMediaType(bytes([], "%PDF-1.7"))).toBe("unknown");
  expect(sniffMediaType(new Uint8Array(0))).toBe("unknown");
  expect(sniffMediaType(bytes([0xff, 0xd8]))).toBe("unknown");
});

test("API がそのまま受け付ける画像", () => {
  expect(uploadableAsIs("jpeg")).toBe(true);
  expect(uploadableAsIs("heic")).toBe(true);
  expect(uploadableAsIs("gif")).toBe(false);
  expect(uploadableAsIs("video")).toBe(false);
});
