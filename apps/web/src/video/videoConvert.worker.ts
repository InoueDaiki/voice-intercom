// 動画の変換の Worker。メインスレッド(画面)を固めないよう、読み書きと WebCodecs の符号化をここで行う。
// MP4 / MOV の読み書きは Mediabunny(設計メモの「Web 版の動画の変換」)。
//
// - probe: 元の動画を測る(コーデック、幅・高さ、フレームレート、ビットレート、パケットの数)。
// - convert: H.264(と AAC)の MP4 にし、OPFS の一時ファイルに書く。moov は先頭に置く
//   (fastStart: "reserve"。パケットの数の上限をメインスレッドが見積もって渡す)。
//   解像度・フレームレート・回転は元のまま。復号できない、符号化器が無いときは unsupported を返す
//   (メインスレッドは元のまま送る)。
// - cancel: 変換を止め、作りかけの一時ファイルを消す。
//
// 1つの Worker で1つの動画だけを扱い、終わったらメインスレッドが terminate する。
import {
  ALL_FORMATS,
  BlobSource,
  canEncodeAudio,
  Conversion,
  ConversionCanceledError,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny";

import { TEMP_DIR, type WorkerProbe, type WorkerRequest, type WorkerResponse } from "./protocol.ts";

// 進み具合を知らせる間隔(ミリ秒)
const PROGRESS_INTERVAL_MS = 200;

// lib に WebWorker を入れていないので、使うものだけを書く
interface SyncAccessHandle {
  write(data: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}
type SyncCapableFileHandle = FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> };

let conversion: Conversion | undefined;
let cancelRequested = false;

function post(message: WorkerResponse): void {
  postMessage(message);
}

addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  switch (request.type) {
    case "probe":
      probe(request.file).then(post, (e: unknown) => post({ type: "unreadable", reason: errorText(e) }));
      return;
    case "convert":
      convert(request).then(post, (e: unknown) => post({ type: "error", message: errorText(e) }));
      return;
    case "cancel":
      cancelRequested = true;
      void conversion?.cancel();
      return;
  }
});

function openInput(file: File): Input {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

async function probe(file: File): Promise<WorkerResponse> {
  const input = openInput(file);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) {
      return { type: "unreadable", reason: "映像のトラックが無い" };
    }
    const audio = await input.getPrimaryAudioTrack();
    // MP4 / MOV はサンプルの表から数えるので、全体を読まずに済む
    const videoStats = await video.computePacketStats();
    const audioStats = audio ? await audio.computePacketStats() : undefined;
    const duration = await input.computeDuration();
    const result: WorkerProbe = {
      width: video.displayWidth,
      height: video.displayHeight,
      durationMs: Number.isFinite(duration) && duration > 0 ? duration * 1000 : undefined,
      frameRate: videoStats.averagePacketRate > 0 ? videoStats.averagePacketRate : undefined,
      videoBitrate: videoStats.averageBitrate > 0 ? Math.round(videoStats.averageBitrate) : undefined,
      videoCodec: videoCodecName(video),
      audioCodec: audio ? (audio.codec ?? "unknown") : undefined,
      audioChannels: audio?.numberOfChannels,
      videoPackets: videoStats.packetCount,
      audioPackets: audioStats?.packetCount,
      hdr: await video.hasHighDynamicRange(),
    };
    return { type: "probed", probe: result };
  } finally {
    input.dispose();
  }
}

// client-core の決め方(planVideo)は "h264" で見るので、Mediabunny の "avc" を読み替える
function videoCodecName(track: InputVideoTrack): string {
  return track.codec === "avc" ? "h264" : (track.codec ?? "unknown");
}

// 元のまま入れられる音声(AAC の 2 チャンネルまで)か
function audioCopyable(track: InputAudioTrack): boolean {
  return track.codec === "aac" && track.numberOfChannels <= 2;
}

async function convert(request: Extract<WorkerRequest, { type: "convert" }>): Promise<WorkerResponse> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(TEMP_DIR, { create: true });
  const handle = (await dir.getFileHandle(request.outName, { create: true })) as SyncCapableFileHandle;
  const access = await handle.createSyncAccessHandle();
  let closed = false;
  const closeAccess = () => {
    if (!closed) {
      closed = true;
      access.flush();
      access.close();
    }
  };
  const input = openInput(request.file);
  let finished = false;
  try {
    access.truncate(0);
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) {
      return { type: "unsupported", reason: "映像のトラックが無い" };
    }
    // 音声を符号化し直すのに、ブラウザに AAC の符号化器が無ければ(Firefox、Linux の Chrome など)、
    // Mediabunny の拡張(libavcodec の WebAssembly)を使う。大きいので要るときだけ読み込む
    if (audio && !audioCopyable(audio) && !(await canEncodeAudio("aac"))) {
      const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
      registerAacEncoder();
    }

    const writable = new WritableStream<StreamTargetChunk>({
      write(chunk) {
        access.write(chunk.data, { at: chunk.position });
      },
      close: closeAccess,
    });
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: "reserve" }),
      target: new StreamTarget(writable, { chunked: true }),
    });
    reservePacketCounts(output, request.videoPacketLimit, request.audioPacketLimit);

    const transcode = request.videoBitrate !== undefined;
    const c = await Conversion.init({
      input,
      output,
      // iPhone の MOV の、メタデータのトラックなどは入れない
      tracks: "primary",
      showWarnings: false,
      video: transcode
        ? { codec: "avc", quality: new Quality({ bitrate: request.videoBitrate! }), forceTranscode: true }
        : // H.264 のまま入れ直す(codec を avc にしておくと、入れ直せないときも H.264 で符号化する)
          { codec: "avc" },
      audio: (track) =>
        audioCopyable(track)
          ? { codec: "aac" }
          : { codec: "aac", numberOfChannels: request.audioChannels, quality: new Quality({ bitrate: request.audioBitrate }) },
    });
    // 映像か音声を落とすことになるなら、変換しない(元のまま送るほうがよい)
    const dropped = c.discardedTracks.filter((d) => d.track === video || d.track === audio);
    if (!c.isValid || dropped.length > 0) {
      return {
        type: "unsupported",
        reason: dropped.map((d) => `${d.track.type}: ${d.reason}`).join(", ") || "変換できない",
      };
    }
    conversion = c;
    if (cancelRequested) {
      return { type: "cancelled" };
    }
    let last = 0;
    c.onProgress = (progress) => {
      const now = Date.now();
      if (now - last >= PROGRESS_INTERVAL_MS) {
        last = now;
        post({ type: "progress", progress });
      }
    };
    await c.execute();
    closeAccess();
    finished = true;
    return { type: "done" };
  } catch (e) {
    if (e instanceof ConversionCanceledError || cancelRequested) {
      return { type: "cancelled" };
    }
    throw e;
  } finally {
    input.dispose();
    try {
      closeAccess();
    } catch {
      // 閉じられなくても、Worker を terminate すれば放される
    }
    if (!finished) {
      await dir.removeEntry(request.outName).catch((e: unknown) => console.info("作りかけの一時ファイルを消せなかった", e));
    }
  }
}

// moov を先頭に置く(fastStart: "reserve")には、トラックごとのパケットの数の上限が要る。
// Mediabunny の Conversion はトラックの設定を外から渡せないので、トラックを足すところで上限を書き足す
function reservePacketCounts(output: Output, videoLimit: number, audioLimit: number): void {
  const addVideoTrack = output.addVideoTrack.bind(output);
  const addAudioTrack = output.addAudioTrack.bind(output);
  output.addVideoTrack = (source, metadata = {}) =>
    addVideoTrack(source, { ...metadata, maximumPacketCount: videoLimit });
  output.addAudioTrack = (source, metadata = {}) =>
    addAudioTrack(source, { ...metadata, maximumPacketCount: audioLimit });
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
