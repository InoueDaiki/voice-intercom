// ブラウザでの動画の変換(メインスレッドの側)。設計メモの「Web 版の動画の変換」。
//
// 元の解像度・フレームレートのまま、見合ったビットレートの H.264 の MP4 にする(決め方は client-core の
// planVideo。Flutter 版と同じ)。読み書きと符号化は Worker(videoConvert.worker.ts)で行い、出力は
// OPFS の一時ファイルに書く(10GB までの動画をメモリに載せない)。
//
// 変換できないとき(WebCodecs・Worker・OPFS が無い、動画として読めない、復号できない、H.264 の符号化器が
// 無い、空き容量が足りない、途中で失敗した)は undefined を返し、元のまま送らせる(変換を足す前と同じ)。
// 変換すると 10GB を超えそうなら、符号化する前に UnsupportedMediaError を投げる。
import {
  AUDIO_BITRATE_PER_CHANNEL,
  estimateTranscodedBytes,
  MAX_UPLOAD_BYTES,
  outputAudioChannels,
  planVideo,
  readMp4Layout,
  reservedPacketCount,
  UnsupportedMediaError,
} from "@voice-intercom/client-core";

import { TEMP_DIR, type WorkerProbe, type WorkerRequest, type WorkerResponse } from "./protocol.ts";

// 取りやめを伝えてから、Worker が一時ファイルを閉じて消すのを待つ長さ(ミリ秒)
const CANCEL_WAIT_MS = 2000;

// 前の変換の残り(タブを閉じた、落ちた)を消すまでの時間。ほかのタブで送っている途中のものを消さないよう長めにする
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

// 空き容量の余裕(見積もりの外れと、ほかの書き込みのため)
const STORAGE_MARGIN_BYTES = 64 * 1024 * 1024;

export interface VideoConvertOptions {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

// 変換して作った一時ファイル(File → OPFS のファイル名)。送り終えたら releaseConvertedVideo で消す
const converted = new WeakMap<Blob, string>();

// このブラウザで変換を試せるか
export function canConvertVideo(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoDecoder !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

// 動画を H.264 の MP4 にする。そのまま送ってよいか、変換できなければ undefined
export async function convertVideo(file: File, options: VideoConvertOptions = {}): Promise<File | undefined> {
  const { signal } = options;
  throwIfAborted(signal);
  if (!canConvertVideo()) {
    console.info("動画の変換に要る API(WebCodecs、Worker、OPFS)が無いので、元のまま送る");
    return undefined;
  }
  const layout = await readMp4Layout(
    async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
    file.size,
  );
  const worker = new Worker(new URL("./videoConvert.worker.ts", import.meta.url), { type: "module" });
  const channel = new WorkerChannel(worker);
  try {
    const probed = await channel.request({ type: "probe", file }, signal);
    if (probed.type !== "probed") {
      console.warn("動画を読めないので、元のまま送る", probed);
      return undefined;
    }
    const probe = probed.probe;
    const plan = planVideo(probe, layout);
    console.info("動画の整え方", plan, probe, layout);
    if (plan.kind === "asIs") {
      return undefined;
    }
    let expected = file.size;
    if (plan.kind === "transcode") {
      const estimate = estimateTranscodedBytes(probe, plan.videoBitrate);
      if (estimate !== undefined && estimate > MAX_UPLOAD_BYTES) {
        // 何十分も符号化した後で送れないと分かるのを避ける(Flutter 版と同じ)
        throw new UnsupportedMediaError("変換すると 10GB を超えそうなので送れない");
      }
      expected = Math.max(expected, estimate ?? 0);
    }
    if (!(await hasRoomFor(expected))) {
      console.warn("一時ファイルを置く空き容量が足りないので、元のまま送る");
      return undefined;
    }
    await removeStaleTemps();

    const outName = `${Date.now()}-${crypto.randomUUID()}.mp4`;
    const channels = outputAudioChannels(probe.audioChannels);
    const result = await channel.request(
      {
        type: "convert",
        file,
        outName,
        videoBitrate: plan.kind === "transcode" ? plan.videoBitrate : undefined,
        audioChannels: channels,
        audioBitrate: AUDIO_BITRATE_PER_CHANNEL * channels,
        videoPacketLimit: reservedPacketCount("video", probe.videoPackets, probe.durationMs),
        audioPacketLimit: reservedPacketCount("audio", probe.audioPackets ?? 0, probe.durationMs),
      },
      signal,
      options.onProgress,
      outName,
    );
    if (result.type !== "done") {
      console.warn("動画を変換できなかったので、元のまま送る", result);
      return undefined;
    }
    const dir = await tempDir();
    const out = await (await dir.getFileHandle(outName)).getFile();
    converted.set(out, outName);
    logResult(probe, out);
    return out;
  } finally {
    channel.close();
  }
}

// 変換して作った一時ファイルを消す(送り終えたか、諦めたとき)。変換したものでなければ何もしない
export async function releaseConvertedVideo(file: Blob): Promise<void> {
  const name = converted.get(file);
  if (name === undefined) {
    return;
  }
  converted.delete(file);
  await (await tempDir()).removeEntry(name);
}

function logResult(probe: WorkerProbe, out: File): void {
  const seconds = (probe.durationMs ?? 0) / 1000;
  const mbps = seconds > 0 ? ((out.size * 8) / seconds / 1e6).toFixed(1) : "?";
  console.info(`動画を変換した: ${out.size} バイト、約 ${mbps}Mbps${probe.hdr ? "(元は HDR)" : ""}`);
}

async function tempDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(TEMP_DIR, { create: true });
}

async function hasRoomFor(bytes: number): Promise<boolean> {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    if (quota === undefined || usage === undefined) {
      return true;
    }
    return quota - usage >= bytes + STORAGE_MARGIN_BYTES;
  } catch {
    return true;
  }
}

// 前の変換の残りを消す(名前の先頭が作った時刻)。使っている途中のものは消せずに失敗するので無視する
async function removeStaleTemps(): Promise<void> {
  try {
    const dir = await tempDir();
    const now = Date.now();
    // TypeScript の DOM の型に、ディレクトリの keys() がまだ無い
    const names = (dir as unknown as { keys(): AsyncIterable<string> }).keys();
    for await (const name of names) {
      const created = Number(name.split("-", 1)[0]);
      if (!Number.isFinite(created) || now - created > STALE_TEMP_MS) {
        await dir.removeEntry(name).catch(() => {});
      }
    }
  } catch (e) {
    console.info("前の変換の一時ファイルを消せなかった", e);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("取りやめた");
  }
}

// Worker への1回ずつの頼みごと。progress は途中の知らせ、それ以外が答え
class WorkerChannel {
  private readonly worker: Worker;
  // 取りやめを伝えて、Worker の後始末を待っている
  private cancelling = false;

  constructor(worker: Worker) {
    this.worker = worker;
  }

  // 使い終えた。取りやめの後始末を待っているなら、待ち終えてから terminate する
  close(): void {
    if (!this.cancelling) {
      this.worker.terminate();
    }
  }

  request(
    message: WorkerRequest,
    signal: AbortSignal | undefined,
    onProgress?: (progress: number) => void,
    outName?: string,
  ): Promise<Exclude<WorkerResponse, { type: "progress" }>> {
    return new Promise((resolve, reject) => {
      const done = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        signal?.removeEventListener("abort", onAbort);
      };
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        if (data.type === "progress") {
          onProgress?.(data.progress);
          return;
        }
        done();
        resolve(data);
      };
      const onError = (event: ErrorEvent) => {
        done();
        // Worker を読み込めない(古いブラウザで module の Worker が無いなど)も、変換できないものとして扱う
        resolve({ type: "error", message: event.message || "Worker が失敗した" });
      };
      const onAbort = () => {
        done();
        const reason = signal?.reason ?? new Error("取りやめた");
        // Worker に止めさせ、一時ファイルを閉じて消すのを少し待つ。返事が無ければ terminate の後に消す
        this.cancelling = true;
        this.worker.postMessage({ type: "cancel" } satisfies WorkerRequest);
        void waitForCancelled(this.worker).then(async () => {
          this.worker.terminate();
          if (outName !== undefined) {
            await tempDir()
              .then((dir) => dir.removeEntry(outName))
              .catch(() => {});
          }
        });
        reject(reason);
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.worker.postMessage(message);
    });
  }
}

function waitForCancelled(worker: Worker): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, CANCEL_WAIT_MS);
    function finish() {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      resolve();
    }
    function onMessage(event: MessageEvent<WorkerResponse>) {
      if (event.data.type !== "progress") {
        finish();
      }
    }
    worker.addEventListener("message", onMessage);
  });
}
