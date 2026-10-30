// Android の動画を測り、H.264 の MP4 に整える。iOS には無い(undefined)。
// 整え方は client-core の planVideo が決める
import { requireOptionalNativeModule } from "expo";

export interface NativeVideoProbe {
  width?: number;
  height?: number;
  durationMs?: number;
  frameRate?: number;
  videoBitrate?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
}

interface NativeModule {
  probe(uri: string): Promise<NativeVideoProbe>;
  // videoBitrate が null なら符号化し直さず MP4 に入れ直す。出力のパスを返す
  transcode(uri: string, videoBitrate: number | null): Promise<string>;
  cancel(): Promise<void>;
  addListener(event: "onProgress", listener: (e: { progress: number }) => void): { remove(): void };
}

export const videoTranscode = requireOptionalNativeModule<NativeModule>("VideoTranscode") ?? undefined;
