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
    delete() {}
  }
  return { File };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// 符号化し直す動画を整える
function prepare(name: string, signal?: AbortSignal) {
  return import("./mobileMedia.ts").then(({ mobileMediaPreparer }) =>
    mobileMediaPreparer.prepare({ uri: `file:///${name}`, name }, undefined, signal),
  );
}

// 測り終えて列に並ぶまで待つ
async function queued(count: number) {
  await vi.waitFor(() => expect(native.probe).toHaveBeenCalledTimes(count));
  await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("mobileMediaPreparer", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    native.probe.mockResolvedValue({ width: 1920, height: 1080, durationMs: 1000, videoCodec: "hevc", audioCodec: "aac" });
    native.addListener.mockReturnValue({ remove: vi.fn() });
    native.cancel.mockResolvedValue(undefined);
  });

  it("別のルームの動画は、前の変換が終わるまで待ってから変換する", async () => {
    const first = deferred<string>();
    native.transcode.mockReturnValueOnce(first.promise).mockResolvedValueOnce("/cache/b.mp4");

    const a = prepare("a.mov");
    const b = prepare("b.mov");
    await queued(2);
    expect(native.transcode).toHaveBeenCalledOnce();

    first.resolve("/cache/a.mp4");
    await expect(a).resolves.toMatchObject({ file: { uri: "file:///cache/a.mp4", temporary: true } });
    await expect(b).resolves.toMatchObject({ file: { uri: "file:///cache/b.mp4", temporary: true } });
    expect(native.transcode).toHaveBeenCalledTimes(2);
  });

  it("前の変換が失敗しても、次の変換に進む", async () => {
    const first = deferred<string>();
    native.transcode.mockReturnValueOnce(first.promise).mockResolvedValueOnce("/cache/b.mp4");

    const a = prepare("a.mov");
    const b = prepare("b.mov");
    await queued(2);
    first.reject(Object.assign(new Error("壊れた動画"), { code: "ERR_TRANSCODE" }));

    // 動画そのものを変換できないときは、これまでどおり元のまま送る
    await expect(a).resolves.toMatchObject({ file: { uri: "file:///a.mov", temporary: false } });
    await expect(b).resolves.toMatchObject({ file: { uri: "file:///cache/b.mp4", temporary: true } });
  });

  it("順番を待っている間に取りやめたら、すぐに抜ける。動いている変換は止めず、次へ進む", async () => {
    const first = deferred<string>();
    native.transcode.mockReturnValueOnce(first.promise).mockResolvedValueOnce("/cache/c.mp4");
    const controller = new AbortController();

    const a = prepare("a.mov");
    const b = prepare("b.mov", controller.signal);
    const c = prepare("c.mov");
    await queued(3);

    controller.abort(new MediaCancelledError());
    await expect(b).rejects.toBeInstanceOf(MediaCancelledError);
    expect(native.cancel).not.toHaveBeenCalled();

    first.resolve("/cache/a.mp4");
    await a;
    await expect(c).resolves.toMatchObject({ file: { uri: "file:///cache/c.mp4" } });
    expect(native.transcode.mock.calls.map(([uri]) => uri)).toEqual(["file:///a.mov", "file:///c.mov"]);
  });

  it("動いている変換を取りやめたら、ネイティブを止めて次へ進む", async () => {
    const first = deferred<string>();
    native.transcode.mockReturnValueOnce(first.promise).mockResolvedValueOnce("/cache/b.mp4");
    native.cancel.mockImplementation(async () => first.reject(new Error("変換を取りやめた")));
    const controller = new AbortController();

    const a = prepare("a.mov", controller.signal);
    const b = prepare("b.mov");
    await queued(2);
    controller.abort(new MediaCancelledError());

    await expect(a).rejects.toThrow("変換を取りやめた");
    expect(native.cancel).toHaveBeenCalledOnce();
    await expect(b).resolves.toMatchObject({ file: { uri: "file:///cache/b.mp4" } });
  });

  it("BUSY を受けたら、元のまま送らず失敗にする", async () => {
    native.transcode.mockRejectedValueOnce(Object.assign(new Error("別の変換が動いている"), { code: "ERR_TRANSCODE_BUSY" }));
    await expect(prepare("a.mov")).rejects.toThrow("別の動画を変換している");

    // やり直せば変換できる
    native.transcode.mockResolvedValueOnce("/cache/a.mp4");
    await expect(prepare("a.mov")).resolves.toMatchObject({ file: { uri: "file:///cache/a.mp4", temporary: true } });
  });

  it("進み具合は、自分の番の間だけ受け取る", async () => {
    const first = deferred<string>();
    const remove = vi.fn();
    native.addListener.mockReturnValue({ remove });
    native.transcode.mockReturnValueOnce(first.promise).mockResolvedValueOnce("/cache/b.mp4");

    const a = prepare("a.mov");
    const b = prepare("b.mov");
    await queued(2);
    expect(native.addListener).toHaveBeenCalledOnce();

    first.resolve("/cache/a.mp4");
    await Promise.all([a, b]);
    expect(native.addListener).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
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
