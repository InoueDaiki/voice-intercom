import { MediaCancelledError } from "@voice-intercom/client-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  probe: vi.fn(),
  transcode: vi.fn(),
  cancel: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock("@voice-intercom/video-transcode", () => ({ videoTranscode: native }));
vi.mock("expo-image-manipulator", () => ({ ImageManipulator: {}, SaveFormat: {} }));
vi.mock("expo-video-thumbnails", () => ({ getThumbnailAsync: vi.fn() }));
// MP4 の先頭(ftyp)。動画と見分けられる
vi.mock("expo-file-system", () => {
  const header = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  class File {
    size = 1000;
    open() {
      return { offset: 0, readBytes: async () => header, close() {} };
    }
  }
  return { File };
});

describe("mobileMediaPreparer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("測っている間に取りやめたら、変換を始めない", async () => {
    const { mobileMediaPreparer } = await import("./mobileMedia.ts");
    const controller = new AbortController();
    native.probe.mockImplementation(async () => {
      controller.abort(new MediaCancelledError());
      return { width: 1920, height: 1080, durationMs: 1000, videoCodec: "hevc", audioCodec: "aac" };
    });

    await expect(
      mobileMediaPreparer.prepare({ uri: "file:///a.mov", name: "a.mov" }, undefined, controller.signal),
    ).rejects.toBeInstanceOf(MediaCancelledError);
    expect(native.transcode).not.toHaveBeenCalled();
    expect(native.addListener).not.toHaveBeenCalled();
  });
});
