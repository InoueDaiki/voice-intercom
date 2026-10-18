import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  ApiError,
  type CompletedPart,
  type CreateMediaUploadRequest,
  type MediaUpload,
  type TimelineEvent,
  type UploadPartUrls,
} from "../api.ts";
import { flush, mediaEvent } from "../testing/fixtures.ts";
import { MediaUploader, type MediaUploadBackend } from "./mediaUploader.ts";
import { type MediaPreparer, type PreparedMedia, UnsupportedMediaError } from "./preparedMedia.ts";

// 選んだもの・本体ともにパス(文字列)で表す
class FakePreparer implements MediaPreparer<string, string> {
  calls = 0;
  error: Error | undefined;
  video = false;
  thumbnail: Uint8Array | undefined = Uint8Array.from([0xff, 0xd8, 0xff]);
  released: string[] = [];
  // true にすると、abort されるまで整え終えない(長い動画の変換)
  hang = false;
  // abort されて止まった数
  aborted = 0;

  async prepare(source: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<PreparedMedia<string>> {
    this.calls++;
    onProgress?.(0.5);
    if (this.hang) {
      await new Promise<void>((_, reject) => {
        signal?.addEventListener("abort", () => {
          this.aborted++;
          reject(signal.reason);
        });
      });
    }
    if (this.error) {
      throw this.error;
    }
    return {
      file: `${source}.out`,
      contentType: this.video ? "video/mp4" : "image/jpeg",
      sizeBytes: 100,
      isVideo: this.video,
      thumbnail: this.thumbnail,
      size: this.video ? { width: 720, height: 1280 } : { width: 1600, height: 1200 },
      durationMs: this.video ? 15500 : undefined,
    };
  }

  async release(media: PreparedMedia<string>): Promise<void> {
    this.released.push(media.file);
  }
}

class FakeBackend implements MediaUploadBackend<string> {
  readonly calls: string[] = [];
  readonly requests: CreateMediaUploadRequest[] = [];
  readonly failures = new Map<string, Error>();
  expiresAt = "2026-10-13T01:00:00.000Z";
  private tickets = 0;
  // これを設定すると、uploads はマルチパート(パートの大きさ)を返す
  partSize: number | undefined;
  // パートの PUT の失敗(パートの番号 → 残りの失敗の回数)
  readonly partFailures = new Map<number, number>();
  // complete に渡された parts
  completedParts: CompletedPart[] | undefined;
  // 同時に PUT しているパートの数の最大
  maxInFlight = 0;
  private inFlight = 0;
  // true にすると、パートの PUT が abort されるまで終わらない
  hangParts = false;
  // abort された PUT の数
  abortedPuts = 0;

  private maybeFail(name: string): void {
    const e = this.failures.get(name);
    if (e) {
      this.failures.delete(name);
      throw e;
    }
  }

  async createUpload(_roomId: string, request: CreateMediaUploadRequest): Promise<MediaUpload> {
    this.calls.push("uploads");
    this.requests.push(request);
    this.maybeFail("uploads");
    const id = `media${++this.tickets}`;
    const size = this.partSize;
    // API と同じ決め方(画像4種と video/* 以外はファイル)
    const isFile =
      !["image/jpeg", "image/png", "image/webp", "image/heic"].includes(request.content_type) &&
      !request.content_type.startsWith("video/");
    return {
      media_id: id,
      upload_url: size === undefined ? `https://s3.example/${id}/original` : null,
      content_disposition: isFile && size === undefined ? `attachment; filename="${request.file_name}"` : null,
      thumbnail_upload_url: request.has_thumbnail ? `https://s3.example/${id}/thumbnail` : null,
      expires_at: this.expiresAt,
      multipart: size === undefined ? null : { part_size: size, part_count: Math.ceil(request.size_bytes / size) },
    };
  }

  async partUrls(_roomId: string, mediaId: string, partNumbers: number[], thumbnail = false): Promise<UploadPartUrls> {
    this.calls.push(`parts ${mediaId} [${partNumbers.join(", ")}]${thumbnail ? " thumbnail" : ""}`);
    this.maybeFail("parts");
    return {
      parts: partNumbers.map((n) => ({
        part_number: n,
        url: `https://s3.example/${mediaId}/original?partNumber=${n}`,
      })),
      thumbnail_upload_url: thumbnail ? `https://s3.example/${mediaId}/thumbnail?again` : null,
      expires_at: this.expiresAt,
    };
  }

  async putFile(
    url: string,
    _file: string,
    options: {
      offset: number;
      length: number;
      contentType: string | undefined;
      contentDisposition?: string;
      onProgress?: (sent: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<string | undefined> {
    const part = /[?&]partNumber=(\d+)/.exec(url)?.[1] ?? null;
    if (part !== null && this.hangParts) {
      this.calls.push(`part ${part} (hang)`);
      return new Promise((_, reject) => {
        options.signal?.addEventListener("abort", () => {
          this.abortedPuts++;
          reject(options.signal!.reason);
        });
      });
    }
    if (part === null) {
      this.calls.push(
        `put ${url} ${options.contentType}${options.contentDisposition ? ` (${options.contentDisposition})` : ""}`,
      );
      options.onProgress?.(options.length);
      this.maybeFail("put");
      return '"single"';
    }
    this.calls.push(`part ${part} ${options.offset}+${options.length}`);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      // 並べて送っていることを確かめるため、ほかのパートに順を譲る
      await new Promise((resolve) => setTimeout(resolve, 0));
      options.onProgress?.(options.length);
      const n = Number(part);
      const left = this.partFailures.get(n) ?? 0;
      if (left > 0) {
        this.partFailures.set(n, left - 1);
        throw new Error(`パート ${n} の回線が切れた`);
      }
      return `"etag-${n}"`;
    } finally {
      this.inFlight--;
    }
  }

  async putBytes(url: string, _bytes: Uint8Array, contentType: string): Promise<void> {
    this.calls.push(`put ${url} ${contentType}`);
    this.maybeFail("thumbnail");
  }

  async complete(_roomId: string, mediaId: string, parts?: CompletedPart[]): Promise<TimelineEvent> {
    this.calls.push(`complete ${mediaId}`);
    this.completedParts = parts;
    this.maybeFail("complete");
    return mediaEvent("2026-10-13T00:00:00.000Z", { sourceId: mediaId });
  }
}

let backend: FakeBackend;
let preparer: FakePreparer;
let completed: TimelineEvent[];
let uploader: MediaUploader<string, string>;
let now: number;

function makeUploader(): MediaUploader<string, string> {
  return new MediaUploader({
    roomId: "r1",
    backend,
    preparer,
    onCompleted: (e) => completed.push(e),
    partConcurrency: 2,
    partRetryDelayMs: 0,
    now: () => now,
  });
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  backend = new FakeBackend();
  preparer = new FakePreparer();
  completed = [];
  now = Date.UTC(2026, 9, 13);
  uploader = makeUploader();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// 順番待ちの処理が終わるまで待つ
const settle = () => flush(50);

test("整える → uploads → 本体とサムネイルの PUT → complete", async () => {
  const item = uploader.submit("/tmp/a.jpg");
  expect(item.state).toBe("preparing");
  await settle();

  expect(backend.calls).toEqual([
    "uploads",
    "put https://s3.example/media1/original image/jpeg",
    "put https://s3.example/media1/thumbnail image/jpeg",
    "complete media1",
  ]);
  const [request] = backend.requests;
  expect(request).toMatchObject({ content_type: "image/jpeg", size_bytes: 100, has_thumbnail: true });
  // 整えた後の本体で測った幅・高さ。画像に長さは無い
  expect([request!.width, request!.height]).toEqual([1600, 1200]);
  expect(request!.duration_ms).toBeNull();
  expect(item.state).toBe("done");
  expect(completed.map((e) => e.media!.media_id)).toEqual(["media1"]);
  // 済んだものは送信中の一覧から外れ、整えたファイルを片付ける
  expect(uploader.items).toEqual([]);
  expect(preparer.released).toEqual(["/tmp/a.jpg.out"]);
});

test("サムネイルが無ければ has_thumbnail を false にし、PUT しない", async () => {
  preparer.thumbnail = undefined;
  uploader.submit("/tmp/a.png");
  await settle();
  expect(backend.requests[0]!.has_thumbnail).toBe(false);
  expect(backend.calls.filter((c) => c.includes("thumbnail"))).toEqual([]);
});

test("動画は video/mp4 で上げる", async () => {
  preparer.video = true;
  const item = uploader.submit("/tmp/a.mov");
  await settle();
  const [request] = backend.requests;
  expect(request!.content_type).toBe("video/mp4");
  expect(item.isVideo).toBe(true);
  expect([request!.width, request!.height]).toEqual([720, 1280]);
  expect(request!.duration_ms).toBe(15500);
});

test("本体の PUT が失敗したら、同じ署名付き URL で PUT からやり直す", async () => {
  backend.failures.set("put", new Error("回線が切れた"));
  const item = uploader.submit("/tmp/a.jpg");
  await settle();
  expect(item.state).toBe("failed");
  expect(item.retryable).toBe(true);
  expect(item.error).toMatch(/^アップロードできなかった/);
  expect(uploader.items).toEqual([item]);

  backend.calls.length = 0;
  uploader.retry(item);
  await settle();
  expect(backend.calls).toEqual([
    "put https://s3.example/media1/original image/jpeg",
    "put https://s3.example/media1/thumbnail image/jpeg",
    "complete media1",
  ]);
  expect(preparer.calls).toBe(1);
  expect(item.state).toBe("done");
});

test("complete が失敗したら、complete だけやり直す", async () => {
  backend.failures.set("complete", new ApiError(503));
  const item = uploader.submit("/tmp/a.jpg");
  await settle();
  expect(item.state).toBe("failed");
  expect(item.error).toBe("保存できなかった(503)");

  backend.calls.length = 0;
  uploader.retry(item);
  await settle();
  expect(backend.calls).toEqual(["complete media1"]);
  expect(item.state).toBe("done");
});

test("complete が 409(本体が置かれていない)なら、PUT からやり直す", async () => {
  backend.failures.set("complete", new ApiError(409, "not uploaded"));
  const item = uploader.submit("/tmp/a.jpg");
  await settle();

  backend.calls.length = 0;
  uploader.retry(item);
  await settle();
  expect(backend.calls).toEqual([
    "put https://s3.example/media1/original image/jpeg",
    "put https://s3.example/media1/thumbnail image/jpeg",
    "complete media1",
  ]);
});

test("サムネイルの PUT だけ失敗したら、本体は上げ直さない", async () => {
  backend.failures.set("thumbnail", new Error("403"));
  const item = uploader.submit("/tmp/a.jpg");
  await settle();

  backend.calls.length = 0;
  uploader.retry(item);
  await settle();
  expect(backend.calls).toEqual(["put https://s3.example/media1/thumbnail image/jpeg", "complete media1"]);
});

test("署名付き URL の期限が近ければ、uploads から取り直す", async () => {
  backend.failures.set("put", new Error("回線が切れた"));
  const item = uploader.submit("/tmp/a.jpg");
  await settle();

  // 期限(01:00)の5分前を過ぎた
  now = Date.UTC(2026, 9, 13, 0, 56);
  backend.calls.length = 0;
  uploader.retry(item);
  await settle();
  expect(backend.calls[0]).toBe("uploads");
  expect(backend.calls.at(-1)).toBe("complete media2");
});

test("uploads が失敗したら uploads からやり直す", async () => {
  backend.failures.set("uploads", new ApiError(500, "boom"));
  const item = uploader.submit("/tmp/a.jpg");
  await settle();
  expect(item.error).toBe("アップロードできなかった(500)");

  backend.calls.length = 0;
  uploader.retry(item);
  await settle();
  expect(backend.calls[0]).toBe("uploads");
  expect(item.state).toBe("done");
});

test("圧縮の失敗はやり直せる。整え直す", async () => {
  preparer.error = new Error("動画を圧縮できなかった");
  const item = uploader.submit("/tmp/a.mov");
  await settle();
  expect(item.state).toBe("failed");
  expect(item.error).toMatch(/^圧縮できなかった/);
  expect(backend.calls).toEqual([]);

  preparer.error = undefined;
  uploader.retry(item);
  expect(item.state).toBe("preparing");
  await settle();
  expect(preparer.calls).toBe(2);
  expect(item.state).toBe("done");
});

test("送れない形式・大きさはやり直させない", async () => {
  preparer.error = new UnsupportedMediaError("10GB を超えるので送れない");
  const item = uploader.submit("/tmp/long.mov");
  await settle();
  expect(item.state).toBe("failed");
  expect(item.retryable).toBe(false);
  expect(item.error).toBe("10GB を超えるので送れない");

  uploader.retry(item);
  await settle();
  expect(preparer.calls).toBe(1);

  uploader.dismiss(item);
  expect(uploader.items).toEqual([]);
});

test("画像・動画でないものはファイルとして、名前と Content-Disposition を付けて上げる", async () => {
  const files = new FakePreparer();
  files.prepare = async (source) => ({
    file: source,
    contentType: "image/gif",
    fileName: "anim.gif",
    sizeBytes: 10,
    isVideo: false,
  });
  preparer = files;
  uploader = makeUploader();
  const item = uploader.submit("/tmp/anim.gif");
  await settle();
  expect(item.state).toBe("done");
  expect(backend.requests[0]).toMatchObject({ content_type: "image/gif", file_name: "anim.gif", has_thumbnail: false });
  expect(backend.calls).toEqual([
    "uploads",
    'put https://s3.example/media1/original image/gif (attachment; filename="anim.gif")',
    "complete media1",
  ]);
});

test("10GB を超えるものは、uploads の前に止めてやり直させない", async () => {
  const huge = new FakePreparer();
  huge.prepare = async (source) => ({
    file: source,
    contentType: "application/zip",
    sizeBytes: 10 * 1024 ** 3 + 1,
    isVideo: false,
  });
  preparer = huge;
  uploader = makeUploader();
  const item = uploader.submit("/tmp/a.zip");
  await settle();
  expect(item.state).toBe("failed");
  expect(item.retryable).toBe(false);
  expect(backend.calls).toEqual([]);
});

test("1つずつ順に送る", async () => {
  uploader.submit("/tmp/a.jpg");
  uploader.submit("/tmp/b.jpg");
  await settle();
  expect(backend.calls.filter((c) => c === "uploads" || c.startsWith("complete"))).toEqual([
    "uploads",
    "complete media1",
    "uploads",
    "complete media2",
  ]);
  expect(completed.map((e) => e.media!.media_id)).toEqual(["media1", "media2"]);
});

describe("取りやめ", () => {
  test("整えている(変換している)ものを取りやめると、変換を止めて一覧から外し、送らない", async () => {
    preparer.hang = true;
    const item = uploader.submit("/tmp/a.mov");
    await settle();
    expect(item.state).toBe("preparing");
    expect(item.progress).toBe(0.5);
    expect(item.cancellable).toBe(true);

    uploader.cancel(item);
    expect(uploader.items).toEqual([]);
    await settle();
    expect(preparer.aborted).toBe(1);
    expect(backend.calls).toEqual([]);
    expect(completed).toEqual([]);
  });

  test("順番を待っているものも取りやめられ、前のものは送り続ける", async () => {
    const first = uploader.submit("/tmp/a.jpg");
    const second = uploader.submit("/tmp/b.jpg");
    uploader.cancel(second);
    expect(uploader.items).toEqual([first]);
    await settle();
    expect(preparer.calls).toBe(1);
    expect(completed.map((e) => e.media!.media_id)).toEqual(["media1"]);
  });

  test("アップロード中のものを取りやめると、PUT を止めて整えたものを消す。次のものは送る", async () => {
    backend.partSize = 30;
    backend.hangParts = true;
    const item = uploader.submit("/tmp/a.jpg");
    await settle();
    expect(item.state).toBe("uploading");
    const next = uploader.submit("/tmp/b.jpg");

    uploader.cancel(item);
    backend.hangParts = false;
    await settle();
    expect(backend.abortedPuts).toBe(2);
    expect(preparer.released).toEqual(["/tmp/a.jpg.out", "/tmp/b.jpg.out"]);
    expect(backend.calls.filter((c) => c.startsWith("complete"))).toEqual(["complete media2"]);
    expect(next.state).toBe("done");
    expect(uploader.items).toEqual([]);
  });

  test("ルームを出たら、変換を止めて一時ファイルを消す", async () => {
    preparer.hang = true;
    uploader.submit("/tmp/a.mov");
    await settle();
    uploader.dispose();
    await settle();
    expect(preparer.aborted).toBe(1);
    expect(backend.calls).toEqual([]);
  });

  test("保存中(complete の後)と、失敗したものは取りやめない(失敗したものは「取り消す」で外す)", async () => {
    backend.failures.set("complete", new ApiError(500, "boom"));
    const item = uploader.submit("/tmp/a.jpg");
    await settle();
    expect(item.state).toBe("failed");
    expect(item.cancellable).toBe(false);
    uploader.cancel(item);
    expect(uploader.items).toEqual([item]);
  });
});

test("送信中のものは dismiss では外さない(取りやめは cancel)", async () => {
  const item = uploader.submit("/tmp/a.jpg");
  uploader.dismiss(item);
  expect(uploader.items).toEqual([item]);
  await settle();
});

describe("マルチパート", () => {
  // 本体は 100 バイト。30 バイトずつの4パート(最後は 10 バイト)
  beforeEach(() => {
    backend.partSize = 30;
  });

  const settleParts = () => flush(200);
  const partCalls = () => backend.calls.filter((c) => c.startsWith("part ")).sort();

  test("サムネイル → パートを並べて PUT → ETag を番号の順に complete", async () => {
    const progress: number[] = [];
    uploader.subscribe(() => {
      const p = uploader.items[0]?.progress;
      if (p !== undefined) {
        progress.push(p);
      }
    });
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();

    expect(item.state).toBe("done");
    expect(backend.calls.slice(0, 3)).toEqual([
      "uploads",
      "put https://s3.example/media1/thumbnail image/jpeg",
      // 1回で、送るパートの URL をまとめて取る
      "parts media1 [1, 2, 3, 4]",
    ]);
    // パートは Content-Type を付けず、ファイルのその範囲だけを送る
    expect(partCalls()).toEqual(["part 1 0+30", "part 2 30+30", "part 3 60+30", "part 4 90+10"]);
    expect(backend.calls.at(-1)).toBe("complete media1");
    expect(backend.completedParts).toEqual([
      { part_number: 1, etag: '"etag-1"' },
      { part_number: 2, etag: '"etag-2"' },
      { part_number: 3, etag: '"etag-3"' },
      { part_number: 4, etag: '"etag-4"' },
    ]);
    // 同時に送るのは partConcurrency 本まで
    expect(backend.maxInFlight).toBe(2);
    // 進み具合は、サムネイルと全パートの合計で、PUT の間は戻らない
    expect(progress.at(-1)).toBe(1);
    const uploading = progress.slice(progress.indexOf(Math.min(...progress)));
    for (let i = 1; i < uploading.length; i++) {
      expect(uploading[i]).toBeGreaterThanOrEqual(uploading[i - 1]!);
    }
  });

  test("失敗したパートは、その場でそのパートだけ送り直す", async () => {
    backend.partFailures.set(2, 2);
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();

    expect(item.state).toBe("done");
    expect(partCalls()).toEqual([
      "part 1 0+30",
      "part 2 30+30",
      "part 2 30+30",
      "part 2 30+30",
      "part 3 60+30",
      "part 4 90+10",
    ]);
  });

  test("送り直してもだめなら失敗にし、やり直しでは送っていないパートだけ送る", async () => {
    backend.partFailures.set(2, 3);
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();

    expect(item.state).toBe("failed");
    expect(item.error).toContain("パート 2 の回線が切れた");
    expect(item.partEtags.has(2)).toBe(false);
    const done = new Set(item.partEtags.keys());
    expect(done.size).toBeGreaterThan(0);

    backend.calls.length = 0;
    uploader.retry(item);
    await settleParts();

    expect(item.state).toBe("done");
    // uploads もサムネイルも、送り終えたパートも送り直さない。URL は期限のうちなので使い回す
    expect(backend.calls.filter((c) => c === "uploads")).toEqual([]);
    expect(backend.calls.filter((c) => c.includes("thumbnail"))).toEqual([]);
    expect(backend.calls.filter((c) => c.startsWith("parts "))).toEqual([]);
    const resent = partCalls().map((c) => Number(c.split(" ")[1]));
    expect(resent.filter((n) => done.has(n))).toEqual([]);
    expect(resent).toContain(2);
    expect(backend.completedParts).toHaveLength(4);
  });

  test("パートの URL の期限が近ければ取り直す。uploads はやり直さない", async () => {
    backend.partFailures.set(1, 3);
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();
    expect(item.state).toBe("failed");

    // 期限(01:00)の5分前を過ぎた
    now = Date.UTC(2026, 9, 13, 0, 56);
    backend.calls.length = 0;
    backend.expiresAt = "2026-10-13T02:00:00.000Z";
    uploader.retry(item);
    await settleParts();

    expect(item.state).toBe("done");
    expect(backend.calls[0]).toBe("parts media1 [1]");
    expect(backend.calls.at(-1)).toBe("complete media1");
  });

  test("サムネイルの URL の期限が過ぎていたら parts で取り直す", async () => {
    backend.failures.set("thumbnail", new Error("回線が切れた"));
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();
    expect(item.state).toBe("failed");

    now = Date.UTC(2026, 9, 13, 0, 56);
    backend.calls.length = 0;
    backend.expiresAt = "2026-10-13T02:00:00.000Z";
    uploader.retry(item);
    await settleParts();

    expect(backend.calls.slice(0, 2)).toEqual([
      "parts media1 [] thumbnail",
      "put https://s3.example/media1/thumbnail?again image/jpeg",
    ]);
    expect(item.state).toBe("done");
  });

  test("complete が 410 なら、uploads からやり直す", async () => {
    backend.failures.set("complete", new ApiError(410, "gone"));
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();
    expect(item.state).toBe("failed");
    expect(item.ticket).toBeUndefined();

    backend.calls.length = 0;
    uploader.retry(item);
    await settleParts();

    expect(backend.calls[0]).toBe("uploads");
    expect(partCalls()).toHaveLength(4);
    expect(backend.calls.at(-1)).toBe("complete media2");
    expect(item.state).toBe("done");
  });

  test("parts が 404(アップロードが無い)なら、uploads からやり直す", async () => {
    backend.failures.set("parts", new ApiError(404, "not found"));
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();
    expect(item.state).toBe("failed");
    expect(item.ticket).toBeUndefined();

    uploader.retry(item);
    await settleParts();
    expect(backend.calls.filter((c) => c === "uploads")).toHaveLength(2);
    expect(item.state).toBe("done");
  });

  test("complete が 409 なら、サムネイルだけ上げ直す", async () => {
    backend.failures.set("complete", new ApiError(409, "no thumbnail"));
    const item = uploader.submit("/tmp/a.mov");
    await settleParts();

    backend.calls.length = 0;
    uploader.retry(item);
    await settleParts();

    expect(backend.calls).toEqual(["put https://s3.example/media1/thumbnail image/jpeg", "complete media1"]);
  });
});
