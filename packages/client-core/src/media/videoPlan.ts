// 動画の整え方の決め方(設計メモの「動画の解像度とビットレート」。Flutter 版の `lib/media/video_plan.dart`)。
//
// 解像度とフレームレートは元のまま保ち、映像のビットレートを
// 幅 × 高さ × 実効のフレームレート × VIDEO_BITS_PER_PIXEL で決める。元の映像のビットレートは超えない。
// 元が既に H.264 で、ビットレートが目標に近ければ、符号化し直さない。
// 動画を読む・書く処理(Web 版は WebCodecs)は端末に依るので各アプリに置き、ここは決め方だけを持つ。

// 1画素・1フレームあたりのビット数(H.264)。1080p30 で約 6.2Mbps、4K60 で約 37Mbps になる
export const VIDEO_BITS_PER_PIXEL = 0.1;

// 映像のビットレートの下限(小さい動画で画質が崩れないように。元のビットレートが低ければそちらに合わせる)
export const MIN_VIDEO_BITRATE = 1000 * 1000;

// 元が H.264 のとき、目標のこの倍までなら符号化し直さない(画質を落としてまで縮めても得が小さい)
export const KEEP_BITRATE_TOLERANCE = 1.25;

// フレームレートが分からないときに使う値
export const DEFAULT_FRAME_RATE = 30;

// 符号化し直す音声のビットレート(1チャンネルあたり)と、チャンネルの数の上限。AAC 2ch で 192kbps
export const AUDIO_BITRATE_PER_CHANNEL = 96 * 1000;
export const MAX_AUDIO_CHANNELS = 2;

// 元の動画を測ったもの。コーデックは "h264"、"hevc"、"aac" などの小文字の名前
export interface VideoProbe {
  // 表示の幅・高さ(回転を反映した後)
  width: number;
  height: number;
  durationMs?: number;
  frameRate?: number;
  // 映像のトラックのビットレート(bps)。分からなければ undefined
  videoBitrate?: number;
  videoCodec?: string;
  // 音声が無ければ undefined
  audioCodec?: string;
  audioChannels?: number;
}

// 映像の目標のビットレート(bps)。frameRate は 30 までをそのまま、30〜60 を半分に数え、60 を超える分は数えない
// (フレームが細かいほど前後のフレームが似ていて、1フレームあたりのビットが少なくて済む)。
export function targetVideoBitrate(width: number, height: number, frameRate: number | undefined): number {
  const fps = frameRate === undefined || !Number.isFinite(frameRate) || frameRate <= 0 ? DEFAULT_FRAME_RATE : frameRate;
  const effectiveFps = Math.min(fps, 30) + Math.max(0, Math.min(fps, 60) - 30) / 2;
  const bitrate = Math.round(width * height * effectiveFps * VIDEO_BITS_PER_PIXEL);
  return Math.max(bitrate, MIN_VIDEO_BITRATE);
}

// MP4 の箱の並び(先頭の階層だけ)
export interface Mp4Layout {
  // ftyp の major brand(isom、mp42、QuickTime の MOV は "qt  ")
  majorBrand: string;
  // moov が mdat より前にある(読みながら再生できる)
  moovBeforeMdat: boolean;
}

export function isQuickTime(layout: Mp4Layout): boolean {
  return layout.majorBrand === "qt  ";
}

// ファイルの先頭の階層の箱を見て、Mp4Layout を返す。MP4 / MOV でなければ undefined。
// read は offset バイト目から最大 length バイトを返す(ファイルの終わりでは短くてよい)。
// 箱の頭(8〜16バイト)だけを読むので、大きなファイルでもすぐ終わる。
export async function readMp4Layout(
  read: (offset: number, length: number) => Promise<Uint8Array>,
  fileLength: number,
): Promise<Mp4Layout | undefined> {
  let brand: string | undefined;
  let offset = 0;
  while (offset + 8 <= fileLength) {
    const head = await read(offset, 16);
    if (head.length < 8) {
      return undefined;
    }
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const type = String.fromCharCode(...head.subarray(4, 8));
    if (size === 1) {
      if (head.length < 16) {
        return undefined;
      }
      size = Number(view.getBigUint64(8));
    } else if (size === 0) {
      size = fileLength - offset;
    }
    if (size < 8) {
      return undefined;
    }
    if (offset === 0) {
      if (type !== "ftyp" || head.length < 12) {
        return undefined;
      }
      brand = String.fromCharCode(...head.subarray(8, 12));
    } else if (type === "moov") {
      return { majorBrand: brand!, moovBeforeMdat: true };
    } else if (type === "mdat") {
      return { majorBrand: brand!, moovBeforeMdat: false };
    }
    offset += size;
  }
  return undefined;
}

// どう整えるか
export type VideoPlan =
  // そのまま送る(H.264 の MP4 で、moov が先頭にあり、ビットレートも目標に近い)
  | { kind: "asIs" }
  // 符号化し直さず、MP4 に入れ直す(moov を先頭に置く。MOV を MP4 にする)
  | { kind: "remux" }
  // H.264 に符号化し直す。videoBitrate は映像のビットレート(bps)
  | { kind: "transcode"; videoBitrate: number };

// 元の動画と箱の並びから、どう整えるかを決める。
export function planVideo(probe: VideoProbe, layout: Mp4Layout | undefined): VideoPlan {
  const target = targetVideoBitrate(probe.width, probe.height, probe.frameRate);
  const source = probe.videoBitrate;
  const isH264 = probe.videoCodec === "h264";
  const audioOk = probe.audioCodec === undefined || probe.audioCodec === "aac";
  if (isH264 && audioOk && source !== undefined && source > 0 && source <= target * KEEP_BITRATE_TOLERANCE) {
    if (layout !== undefined && layout.moovBeforeMdat && !isQuickTime(layout)) {
      return { kind: "asIs" };
    }
    return { kind: "remux" };
  }
  // 元のビットレートは超えない(分からなければ目標のまま)
  const videoBitrate = source !== undefined && source > 0 ? Math.min(target, source) : target;
  return { kind: "transcode", videoBitrate };
}

// 符号化し直したときの音声のチャンネルの数(1〜2)
export function outputAudioChannels(sourceChannels: number | undefined): number {
  return Math.min(Math.max(sourceChannels ?? MAX_AUDIO_CHANNELS, 1), MAX_AUDIO_CHANNELS);
}

// 整えた後の大きさの見積もり(バイト)。符号化する前に上限を超えそうか見るのに使う。
// 音声は符号化し直したときのビットレートで数える。長さが分からなければ undefined
export function estimateTranscodedBytes(probe: VideoProbe, videoBitrate: number): number | undefined {
  const ms = probe.durationMs;
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  const audio = probe.audioCodec !== undefined ? AUDIO_BITRATE_PER_CHANNEL * outputAudioChannels(probe.audioChannels) : 0;
  return Math.round(((videoBitrate + audio) * ms) / 1000 / 8);
}

// moov を先頭に置くために先に取っておく、トラックごとのパケット(フレーム)の数の上限。
// 書き終えるまで数が決まらないので、多めに見積もる(超えると書けない。多すぎても moov の場所が
// 少し空くだけ)。映像は元のパケットの数(フレームレートを変えないので同じ)、音声は元の数と、
// 長さを 96kHz の AAC(1パケット 1024 サンプル)で割った数の大きいほう(サンプルレートや
// コーデックが変わっても足りるように)。どちらも 2 割と 100 個を足す。
export function reservedPacketCount(kind: "video" | "audio", sourcePackets: number, durationMs: number | undefined): number {
  let count = Math.max(0, sourcePackets);
  if (kind === "audio" && durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0) {
    count = Math.max(count, Math.ceil(((durationMs / 1000) * 96_000) / 1024));
  }
  return Math.ceil(count * 1.2) + 100;
}
