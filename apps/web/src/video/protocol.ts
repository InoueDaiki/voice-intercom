// 動画の変換の Worker(videoConvert.worker.ts)とのやり取り。
// Worker は client-core を読み込まない(livekit-client などを Worker に載せない)ので、
// 決め方(ビットレート、取っておくパケットの数)はメインスレッドで計算して渡す。
import type { VideoProbe } from "@voice-intercom/client-core";

// OPFS(Origin Private File System)で、変換した動画を置くディレクトリ
export const TEMP_DIR = "video-convert";

// Worker が測った元の動画
export interface WorkerProbe extends VideoProbe {
  // 映像・音声のパケットの数(moov の場所を取っておくのに使う)
  videoPackets: number;
  audioPackets?: number;
  // HDR(HLG・PQ)か。H.264 の 8 ビットに入れると色が浅くなりうる
  hdr: boolean;
}

export type WorkerRequest =
  | { type: "probe"; file: File }
  | {
      type: "convert";
      file: File;
      // TEMP_DIR の中のファイル名
      outName: string;
      // 映像を符号化し直すなら、そのビットレート(bps)。undefined なら入れ直すだけ
      videoBitrate?: number;
      // 音声を符号化し直すときのチャンネルの数とビットレート(bps)
      audioChannels: number;
      audioBitrate: number;
      // moov を先頭に置くために取っておく、トラックごとのパケットの数
      videoPacketLimit: number;
      audioPacketLimit: number;
    }
  | { type: "cancel" };

export type WorkerResponse =
  | { type: "probed"; probe: WorkerProbe }
  // 動画として読めない(映像のトラックが無い、壊れている)
  | { type: "unreadable"; reason: string }
  | { type: "progress"; progress: number }
  | { type: "done" }
  // このブラウザでは変換できない(復号できない、H.264 か AAC の符号化器が無い)
  | { type: "unsupported"; reason: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };
