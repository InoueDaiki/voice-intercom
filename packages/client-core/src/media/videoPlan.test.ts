import { describe, expect, test } from "vitest";

import {
  estimateTranscodedBytes,
  MIN_VIDEO_BITRATE,
  type Mp4Layout,
  outputAudioChannels,
  planVideo,
  readMp4Layout,
  reservedPacketCount,
  targetVideoBitrate,
  type VideoProbe,
} from "./videoPlan.ts";

// 箱(大きさ 4 バイト + 種類 4 バイト + 中身)
function box(type: string, body: number[] = []): number[] {
  const size = 8 + body.length;
  return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, ...ascii(type), ...body];
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

const ftyp = (brand: string) => box("ftyp", [...ascii(brand), 0, 0, 0, 0, ...ascii("isom")]);

const mp4: Mp4Layout = { majorBrand: "isom", moovBeforeMdat: true };

function layoutOf(bytes: number[]): Promise<Mp4Layout | undefined> {
  const data = Uint8Array.from(bytes);
  return readMp4Layout(async (offset, length) => data.subarray(offset, offset + length), data.length);
}

test("目標のビットレートは 幅×高さ×実効のフレームレート×0.1(30〜60fps は半分に数える)", () => {
  expect(targetVideoBitrate(1920, 1080, 30)).toBe(6220800);
  expect(targetVideoBitrate(1920, 1080, 60)).toBe(9331200);
  expect(targetVideoBitrate(3840, 2160, 60)).toBe(37324800);
  expect(targetVideoBitrate(1280, 720, 30)).toBe(2764800);
  // 60fps を超える分は数えない
  expect(targetVideoBitrate(1920, 1080, 120)).toBe(targetVideoBitrate(1920, 1080, 60));
  // フレームレートが分からなければ 30fps とみなす
  expect(targetVideoBitrate(1920, 1080, undefined)).toBe(6220800);
  expect(targetVideoBitrate(1920, 1080, Number.NaN)).toBe(6220800);
  // 小さい動画は下限まで上げる
  expect(targetVideoBitrate(320, 240, 30)).toBe(MIN_VIDEO_BITRATE);
});

test("HEVC は、解像度とフレームレートに見合ったビットレートで H.264 にする", () => {
  // iPhone の 4K60 の HEVC(縦向き。幅・高さは回転を反映した後)
  const probe: VideoProbe = {
    width: 2160,
    height: 3840,
    frameRate: 59.94,
    videoBitrate: 50_000_000,
    videoCodec: "hevc",
    audioCodec: "aac",
  };
  expect(planVideo(probe, mp4)).toEqual({ kind: "transcode", videoBitrate: targetVideoBitrate(2160, 3840, 59.94) });
});

test("元のビットレートは超えない", () => {
  const probe: VideoProbe = { width: 1920, height: 1080, frameRate: 30, videoBitrate: 3_000_000, videoCodec: "hevc" };
  expect(planVideo(probe, mp4)).toEqual({ kind: "transcode", videoBitrate: 3_000_000 });
  // 元のビットレートが分からなければ目標のまま
  expect(planVideo({ width: 1920, height: 1080, videoCodec: "hevc" }, mp4)).toEqual({
    kind: "transcode",
    videoBitrate: 6220800,
  });
});

test("H.264 でビットレートが目標の1.25倍を超えれば、符号化し直す", () => {
  const probe: VideoProbe = {
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitrate: 17_000_000,
    videoCodec: "h264",
    audioCodec: "aac",
  };
  expect(planVideo(probe, mp4)).toEqual({ kind: "transcode", videoBitrate: 6220800 });
});

test("H.264 でビットレートが目標に近ければ、符号化し直さない", () => {
  const probe: VideoProbe = {
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitrate: 7_000_000,
    videoCodec: "h264",
    audioCodec: "aac",
  };
  // moov が先頭の MP4 ならそのまま
  expect(planVideo(probe, mp4)).toEqual({ kind: "asIs" });
  // moov が末尾、MOV、箱を読めないものは入れ直す
  expect(planVideo(probe, { majorBrand: "mp42", moovBeforeMdat: false })).toEqual({ kind: "remux" });
  expect(planVideo(probe, { majorBrand: "qt  ", moovBeforeMdat: true })).toEqual({ kind: "remux" });
  expect(planVideo(probe, undefined)).toEqual({ kind: "remux" });
});

test("H.264 でも、音声が AAC でないか、ビットレートが分からなければ符号化し直す", () => {
  const opus: VideoProbe = {
    width: 1280,
    height: 720,
    frameRate: 30,
    videoBitrate: 2_000_000,
    videoCodec: "h264",
    audioCodec: "opus",
  };
  expect(planVideo(opus, mp4)).toEqual({ kind: "transcode", videoBitrate: 2_000_000 });
  expect(planVideo({ width: 1280, height: 720, videoCodec: "h264" }, mp4)).toEqual({
    kind: "transcode",
    videoBitrate: 2764800,
  });
  // 音声が無いものはそのまま送れる
  const silent: VideoProbe = { width: 1280, height: 720, frameRate: 30, videoBitrate: 2_000_000, videoCodec: "h264" };
  expect(planVideo(silent, mp4)).toEqual({ kind: "asIs" });
});

test("整えた後の大きさを見積もる(音声は 2 チャンネルまでの AAC で数える)", () => {
  const probe: VideoProbe = { width: 1920, height: 1080, durationMs: 60000, audioCodec: "aac", audioChannels: 6 };
  // 映像 6Mbps + 音声 192kbps で 60 秒
  expect(estimateTranscodedBytes(probe, 6_000_000)).toBe(46440000);
  // 音声が無ければ映像だけ
  expect(estimateTranscodedBytes({ width: 1, height: 1, durationMs: 8000 }, 1_000_000)).toBe(1_000_000);
  expect(estimateTranscodedBytes({ width: 1, height: 1 }, 1)).toBeUndefined();
  expect(outputAudioChannels(1)).toBe(1);
  expect(outputAudioChannels(6)).toBe(2);
  expect(outputAudioChannels(undefined)).toBe(2);
});

test("moov の場所を取るパケットの数は多めに見積もる", () => {
  // 映像は元の数の 1.2 倍 + 100
  expect(reservedPacketCount("video", 1800, 60000)).toBe(2260);
  // 音声は 96kHz の AAC でも足りる数(60 秒で 5625 パケット)
  expect(reservedPacketCount("audio", 2813, 60000)).toBe(6850);
  expect(reservedPacketCount("audio", 2813, undefined)).toBe(3476);
});

describe("箱の並び", () => {
  test("moov が mdat の前か後か", async () => {
    expect(await layoutOf([...ftyp("isom"), ...box("moov", [1, 2, 3]), ...box("mdat", Array(100).fill(0))])).toEqual({
      majorBrand: "isom",
      moovBeforeMdat: true,
    });
    const last = await layoutOf([...ftyp("mp42"), ...box("free"), ...box("mdat", Array(100).fill(0)), ...box("moov")]);
    expect(last?.moovBeforeMdat).toBe(false);
    const mov = await layoutOf([...ftyp("qt  "), ...box("wide"), ...box("mdat")]);
    expect(mov?.majorBrand).toBe("qt  ");
  });

  test("大きさが 64 ビットの箱を飛ばせる", async () => {
    const layout = await layoutOf([
      ...ftyp("isom"),
      // size=1 の後に 64 ビットの大きさ(24 バイト)
      ...[0, 0, 0, 1, ...ascii("free"), 0, 0, 0, 0, 0, 0, 0, 24],
      ...Array(8).fill(0),
      ...box("moov"),
    ]);
    expect(layout?.moovBeforeMdat).toBe(true);
  });

  test("MP4 でないもの、壊れたものは undefined", async () => {
    expect(await layoutOf(ascii("not a video at all"))).toBeUndefined();
    expect(await layoutOf([...ftyp("isom"), 0, 0, 0, 2, 0, 0])).toBeUndefined();
    expect(await layoutOf([...ftyp("isom")])).toBeUndefined();
  });
});
