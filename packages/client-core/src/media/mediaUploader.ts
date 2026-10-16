import {
  ApiError,
  type ClientApi,
  type CompletedPart,
  type CreateMediaUploadRequest,
  type MediaUpload,
  type TimelineEvent,
  type UploadPartUrls,
} from "../api.ts";
import { Observable } from "../observable.ts";
import { MAX_UPLOAD_BYTES, type MediaPreparer, type PreparedMedia, UnsupportedMediaError } from "./preparedMedia.ts";
import { PutFailedError, type SignedPut } from "./signedPut.ts";

// パートの署名付き URL を1回で取れる数(API の parts の上限)
export const MAX_PART_URLS_PER_REQUEST = 100;

// 送信中の画像・動画・ファイルの段階。
export type OutgoingMediaState =
  // 圧縮、サムネイルの作成
  | "preparing"
  // 署名付き URL の取得と、本体(マルチパートならパートごと)・サムネイルの PUT
  | "uploading"
  // complete(履歴への保存)
  | "completing"
  // 履歴に保存できた
  | "done"
  // どこかで失敗した。retryable ならやり直せる
  | "failed";

// 送信中の画像・動画・ファイル1つ。送信者の画面にだけ出す(ほかの人には何も送らない)。
export class OutgoingMedia<S, F> {
  // 端末の中だけの ID(media_id は uploads の後に決まる)
  readonly localId: string;
  // 選んだもの
  readonly source: S;
  state: OutgoingMediaState = "preparing";
  // 今の段階の進み具合(0〜1)。分からなければ undefined
  progress: number | undefined;
  // 失敗の理由(画面に出す)
  error: string | undefined;
  // やり直して直る見込みがあるか(形式や大きさで送れないものは false)
  retryable = true;
  // 整えた本体とサムネイル。やり直しでは作り直さない
  prepared: PreparedMedia<F> | undefined;
  // uploads の応答。1回の PUT なら期限のうち、マルチパートならアップロードが無くなるまで
  // (API が 404・410 を返すまで)、やり直しでも使い回す
  ticket: MediaUpload | undefined;
  bodyUploaded = false;
  thumbnailUploaded = false;
  // マルチパートで PUT し終えたパートの ETag(パートの番号 → ETag)。やり直しでは送らない
  readonly partEtags = new Map<number, string>();
  // マルチパートのパートの署名付き URL(期限のうちは使い回す)
  readonly partUrls = new Map<number, { url: string; expiresAt: number }>();
  // complete の応答(履歴の行)
  event: TimelineEvent | undefined;

  constructor(localId: string, source: S) {
    this.localId = localId;
    this.source = source;
  }

  // 動画らしいか(整える前は分からないので、整えた後の値)
  get isVideo(): boolean {
    return this.prepared?.isVideo ?? false;
  }

  get active(): boolean {
    return this.state !== "done" && this.state !== "failed";
  }

  // uploads からやり直す(送り終えたパートも捨てる)
  resetTicket(): void {
    this.ticket = undefined;
    this.bodyUploaded = false;
    this.thumbnailUploaded = false;
    this.partEtags.clear();
    this.partUrls.clear();
  }
}

// API と S3 への送信。テストでは差し替える。
export interface MediaUploadBackend<F> extends SignedPut<F> {
  createUpload(roomId: string, request: CreateMediaUploadRequest): Promise<MediaUpload>;
  // マルチパートのパート(と、thumbnail ならサムネイル)の署名付き URL
  partUrls(roomId: string, mediaId: string, partNumbers: number[], thumbnail?: boolean): Promise<UploadPartUrls>;
  // マルチパートなら parts に全パートの番号と ETag を渡す
  complete(roomId: string, mediaId: string, parts?: CompletedPart[]): Promise<TimelineEvent>;
}

// uploads・parts・complete は API、PUT は署名付き URL(アプリが差し込む SignedPut)。
// 署名付き URL には API のアクセストークンを付けない
export function apiMediaBackend<F>(api: ClientApi, put: SignedPut<F>): MediaUploadBackend<F> {
  return {
    createUpload: (roomId, request) => api.createMediaUpload(roomId, request),
    partUrls: (roomId, mediaId, partNumbers, thumbnail = false) =>
      api.createUploadPartUrls(roomId, mediaId, partNumbers, thumbnail),
    complete: (roomId, mediaId, parts) => api.completeMediaUpload(roomId, mediaId, parts),
    putFile: (url, file, options) => put.putFile(url, file, options),
    putBytes: (url, bytes, contentType) => put.putBytes(url, bytes, contentType),
  };
}

export interface MediaUploaderOptions<S, F> {
  roomId: string;
  backend: MediaUploadBackend<F>;
  preparer: MediaPreparer<S, F>;
  // 履歴に保存できたら呼ぶ(ルームの表示にすぐ足す)
  onCompleted: (event: TimelineEvent) => void;
  // 署名付き URL の期限まで、これより短ければ取り直す(ミリ秒)
  ticketMarginMs?: number;
  // マルチパートで同時に PUT するパートの数
  partConcurrency?: number;
  // 1つのパートを続けて送ってみる回数(失敗したパートだけ送り直す)
  partAttempts?: number;
  // パートを送り直す前に待つ時間(ミリ秒。2回目からは倍にする)
  partRetryDelayMs?: number;
  // 今の時刻(ミリ秒)。テストで差し替える
  now?: () => number;
}

// 画像・動画・ファイルを送る。整える → uploads → 本体とサムネイルの PUT → complete。
//
// - 1つずつ順に処理する(動画の変換は同時に1つしかできない。回線も分け合わない)。
// - 失敗したら、その段階からやり直せる。整えたファイル、期限のうちの署名付き URL、
//   PUT し終えたものは使い回す。complete が 409(本体かサムネイルが無い)なら PUT からやり直す。
// - complete は2回目からも同じ履歴を返すので、応答が失われたときに呼び直しても重ならない。
// - 大きい本体(API が uploads で multipart を返したもの)は、パートに分けて partConcurrency 本
//   ずつ並べて PUT する。本体はパートごとに読む(全体をメモリに載せない。読み方は SignedPut)。
//   失敗したパートはその場で partAttempts 回まで送り直し、それでもだめなら失敗にする。
//   やり直しでは、送り終えたパートを除いて続きから送る。パートの署名付き URL は、送る前に100個ずつ取る。
// - マルチパートで API が 404・410(アップロードが無い、完了できない)を返したら、uploads から
//   やり直す(送り終えたパートも捨てる)。complete の 409(サムネイルが無い)なら、サムネイルだけ
//   上げ直す。
// - 画像・動画・ファイルには文を添えられない(設計メモの「画像・動画のルームへの配信」)。
//   submit は選んだものだけを受ける。形式は問わず、上限は 10GB(画像・動画でないものはファイルとして
//   ダウンロードだけになる)。
export class MediaUploader<S, F> extends Observable {
  readonly roomId: string;
  private readonly backend: MediaUploadBackend<F>;
  private readonly preparer: MediaPreparer<S, F>;
  private readonly onCompleted: (event: TimelineEvent) => void;
  readonly ticketMarginMs: number;
  readonly partConcurrency: number;
  readonly partAttempts: number;
  readonly partRetryDelayMs: number;
  private readonly now: () => number;

  private readonly itemList: OutgoingMedia<S, F>[] = [];
  private queue: Promise<void> = Promise.resolve();
  private nextId = 0;
  private disposed = false;

  constructor(options: MediaUploaderOptions<S, F>) {
    super();
    this.roomId = options.roomId;
    this.backend = options.backend;
    this.preparer = options.preparer;
    this.onCompleted = options.onCompleted;
    this.ticketMarginMs = options.ticketMarginMs ?? 5 * 60 * 1000;
    this.partConcurrency = options.partConcurrency ?? 4;
    this.partAttempts = options.partAttempts ?? 3;
    this.partRetryDelayMs = options.partRetryDelayMs ?? 1000;
    this.now = options.now ?? Date.now;
  }

  // 送った順。済んだものは除く
  get items(): OutgoingMedia<S, F>[] {
    return this.itemList.filter((m) => m.state !== "done");
  }

  // 選んだものを送る
  submit(source: S): OutgoingMedia<S, F> {
    const item = new OutgoingMedia<S, F>(`local-${this.nextId++}`, source);
    this.itemList.push(item);
    this.enqueue(item);
    return item;
  }

  // 失敗したものをやり直す
  retry(item: OutgoingMedia<S, F>): void {
    if (item.state !== "failed" || !item.retryable) {
      return;
    }
    item.state = item.prepared === undefined ? "preparing" : "uploading";
    item.error = undefined;
    item.progress = undefined;
    this.changed();
    this.enqueue(item);
  }

  // 失敗したものを諦めて、一覧から外す
  dismiss(item: OutgoingMedia<S, F>): void {
    if (item.active) {
      return;
    }
    const i = this.itemList.indexOf(item);
    if (i >= 0) {
      this.itemList.splice(i, 1);
    }
    this.cleanup(item);
    this.changed();
  }

  dispose(): void {
    this.disposed = true;
    for (const item of this.itemList) {
      this.cleanup(item);
    }
  }

  private enqueue(item: OutgoingMedia<S, F>): void {
    this.queue = this.queue.then(() => this.run(item));
  }

  private async run(item: OutgoingMedia<S, F>): Promise<void> {
    if (this.disposed) {
      return;
    }
    try {
      await this.prepare(item);
      await this.upload(item);
      await this.complete(item);
    } catch (e) {
      if (e instanceof UnsupportedMediaError) {
        this.fail(item, e.message, false);
        return;
      }
      if (e instanceof ApiError && (e.status === 404 || e.status === 410) && item.ticket?.multipart != null) {
        // マルチパートのアップロードが無い(期限で消えた)か、完了できない。uploads からやり直す
        item.resetTicket();
      }
      this.fail(item, describe(item.state, e));
    }
  }

  private async prepare(item: OutgoingMedia<S, F>): Promise<void> {
    if (item.prepared !== undefined) {
      return;
    }
    this.set(item, "preparing");
    item.prepared = await this.preparer.prepare(item.source, (p) => {
      item.progress = p;
      this.changed();
    });
  }

  private async upload(item: OutgoingMedia<S, F>): Promise<void> {
    const media = item.prepared!;
    this.set(item, "uploading");
    const ticket = item.ticket;
    // マルチパートは、期限が過ぎても URL を取り直して続ける(送り終えたパートを捨てない)
    if (ticket === undefined || (ticket.multipart == null && this.expiring(ticket.expires_at))) {
      if (media.sizeBytes > MAX_UPLOAD_BYTES) {
        throw new UnsupportedMediaError("10GB を超えるので送れない");
      }
      item.resetTicket();
      item.ticket = await this.backend.createUpload(this.roomId, {
        // 形式は問わない(画像・動画でないものはファイルになる)。確かめるのは API
        content_type: media.contentType,
        file_name: media.fileName ?? null,
        size_bytes: media.sizeBytes,
        has_thumbnail: media.thumbnail !== undefined,
        // 表示の枠(縦横比)と動画の長さ。整えた後の本体で測った値
        width: media.size?.width ?? null,
        height: media.size?.height ?? null,
        duration_ms: media.durationMs ?? null,
      });
    }
    const current = item.ticket!;
    if (current.multipart != null) {
      await this.uploadMultipart(item, current);
      item.progress = 1;
      return;
    }
    const thumbnail = media.thumbnail;
    const total = media.sizeBytes + (thumbnail?.length ?? 0);
    if (!item.bodyUploaded) {
      const uploadUrl = current.upload_url;
      if (uploadUrl == null) {
        throw new Error("uploads の応答に upload_url が無い");
      }
      await this.backend.putFile(uploadUrl, media.file, {
        offset: 0,
        length: media.sizeBytes,
        contentType: media.contentType,
        // ファイルはダウンロードだけにするため、API が決めた値を付ける(署名に入っている)
        contentDisposition: current.content_disposition ?? undefined,
        onProgress: (sent) => {
          item.progress = total === 0 ? undefined : sent / total;
          this.changed();
        },
      });
      item.bodyUploaded = true;
    }
    const thumbnailUrl = current.thumbnail_upload_url;
    if (thumbnail !== undefined && thumbnailUrl != null && !item.thumbnailUploaded) {
      await this.backend.putBytes(thumbnailUrl, thumbnail, "image/jpeg");
      item.thumbnailUploaded = true;
    }
    item.progress = 1;
  }

  // マルチパート。サムネイルを先に上げ(complete がサムネイルを先に確かめるので)、
  // 送っていないパートを partConcurrency 本ずつ並べて PUT する。
  private async uploadMultipart(item: OutgoingMedia<S, F>, ticket: MediaUpload): Promise<void> {
    const media = item.prepared!;
    const multipart = ticket.multipart!;
    const mediaId = ticket.media_id;
    const thumbnail = media.thumbnail;
    const total = media.sizeBytes + (thumbnail?.length ?? 0);
    const partLength = (n: number) => Math.min(multipart.part_size, media.sizeBytes - (n - 1) * multipart.part_size);

    // 進み具合は、送り終えたパートと、送っている途中のパートの合計
    const inFlight = new Map<number, number>();
    const report = () => {
      let sent = item.thumbnailUploaded ? (thumbnail?.length ?? 0) : 0;
      for (const n of item.partEtags.keys()) {
        sent += partLength(n);
      }
      for (const v of inFlight.values()) {
        sent += v;
      }
      item.progress = total === 0 ? undefined : sent / total;
      this.changed();
    };

    report();
    if (thumbnail !== undefined && !item.thumbnailUploaded) {
      let url = ticket.thumbnail_upload_url;
      if (url == null || this.expiring(ticket.expires_at)) {
        const res = await this.backend.partUrls(this.roomId, mediaId, [], true);
        url = res.thumbnail_upload_url;
      }
      if (url == null) {
        throw new Error("サムネイルの署名付き URL が無い");
      }
      await this.backend.putBytes(url, thumbnail, "image/jpeg");
      item.thumbnailUploaded = true;
      report();
    }

    const remaining: number[] = [];
    for (let n = 1; n <= multipart.part_count; n++) {
      if (!item.partEtags.has(n)) {
        remaining.push(n);
      }
    }
    // URL を取るのは同時に1回だけ(並べた PUT が、同じパートの URL を重ねて取らないように)
    let fetching: Promise<void> | undefined;

    const fresh = (n: number): boolean => {
      const cached = item.partUrls.get(n);
      return cached !== undefined && this.now() + this.ticketMarginMs < cached.expiresAt;
    };

    const urlFor = async (n: number): Promise<string> => {
      while (!fresh(n)) {
        if (fetching) {
          await fetching;
          continue;
        }
        // n と、この後に送るパートのうち URL の無いものを、まとめて取る
        const numbers = [n, ...remaining.filter((m) => !fresh(m)).slice(0, MAX_PART_URLS_PER_REQUEST - 1)];
        const done = (async () => {
          const res = await this.backend.partUrls(this.roomId, mediaId, numbers);
          const expiresAt = Date.parse(res.expires_at);
          for (const p of res.parts) {
            item.partUrls.set(p.part_number, { url: p.url, expiresAt });
          }
          if (!fresh(n)) {
            throw new Error(`パート ${n} の署名付き URL を取れなかった`);
          }
        })();
        fetching = done;
        try {
          await done;
        } finally {
          fetching = undefined;
        }
      }
      return item.partUrls.get(n)!.url;
    };

    const sendPart = async (n: number): Promise<void> => {
      for (let attempt = 1; ; attempt++) {
        try {
          const url = await urlFor(n);
          inFlight.set(n, 0);
          const etag = await this.backend.putFile(url, media.file, {
            offset: (n - 1) * multipart.part_size,
            length: partLength(n),
            contentType: undefined,
            onProgress: (sent) => {
              inFlight.set(n, sent);
              report();
            },
          });
          if (!etag) {
            throw new Error(`パート ${n} の応答に ETag が無い`);
          }
          inFlight.delete(n);
          item.partEtags.set(n, etag);
          report();
          return;
        } catch (e) {
          inFlight.delete(n);
          // URL の取得(API)の失敗は、ここでは送り直さない(アップロードが無い 404 などは、
          // やり直しで uploads からにする)
          if (e instanceof ApiError || attempt >= this.partAttempts) {
            throw e;
          }
          if (e instanceof PutFailedError && e.status === 403) {
            // 署名付き URL の期限切れなど。URL を取り直す
            item.partUrls.delete(n);
          }
          console.info(`パート ${n} を送り直す(${attempt} 回目の失敗)`, e);
          await delay(this.partRetryDelayMs * 2 ** (attempt - 1));
        }
      }
    };

    let failure: { error: unknown } | undefined;
    const worker = async () => {
      while (failure === undefined && remaining.length > 0 && !this.disposed) {
        const n = remaining.shift()!;
        try {
          await sendPart(n);
        } catch (e) {
          failure ??= { error: e };
        }
      }
    };

    const workers = Math.min(this.partConcurrency, remaining.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    if (failure) {
      throw failure.error;
    }
    if (item.partEtags.size !== multipart.part_count) {
      throw new Error("パートを送り終えていない");
    }
  }

  private async complete(item: OutgoingMedia<S, F>): Promise<void> {
    this.set(item, "completing");
    const ticket = item.ticket!;
    const multipart = ticket.multipart != null;
    const parts = multipart
      ? [...item.partEtags.entries()].sort(([a], [b]) => a - b).map(([part_number, etag]) => ({ part_number, etag }))
      : undefined;
    let event: TimelineEvent;
    try {
      event = await this.backend.complete(this.roomId, ticket.media_id, parts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 本体かサムネイルが置かれていない(か、大きさが違う)。PUT からやり直す。
        // マルチパートの 409 はサムネイルだけ(本体は完了させてから確かめ、だめなら 410)
        item.thumbnailUploaded = false;
        if (!multipart) {
          item.bodyUploaded = false;
        }
      }
      throw e;
    }
    item.event = event;
    item.state = "done";
    item.progress = undefined;
    this.cleanup(item);
    if (!this.disposed) {
      this.onCompleted(event);
    }
    this.changed();
  }

  private expiring(expiresAt: string): boolean {
    const expires = Date.parse(expiresAt);
    if (Number.isNaN(expires)) {
      return true;
    }
    return this.now() + this.ticketMarginMs > expires;
  }

  private set(item: OutgoingMedia<S, F>, state: OutgoingMediaState): void {
    item.state = state;
    item.progress = undefined;
    this.changed();
  }

  private fail(item: OutgoingMedia<S, F>, message: string, retryable = true): void {
    console.warn(`画像・動画を送れなかった(${item.state}): ${message}`);
    item.state = "failed";
    item.error = message;
    item.retryable = retryable;
    item.progress = undefined;
    this.changed();
  }

  private cleanup(item: OutgoingMedia<S, F>): void {
    const media = item.prepared;
    if (media !== undefined && this.preparer.release) {
      this.preparer.release(media).catch((e: unknown) => console.warn("一時ファイルを消せなかった", e));
    }
  }

  protected override changed(): void {
    if (!this.disposed) {
      super.changed();
    }
  }
}

function describe(stage: OutgoingMediaState, e: unknown): string {
  const what =
    stage === "preparing"
      ? "圧縮できなかった"
      : stage === "uploading"
        ? "アップロードできなかった"
        : stage === "completing"
          ? "保存できなかった"
          : "送れなかった";
  const detail = e instanceof ApiError ? String(e.status) : e instanceof Error ? e.message : String(e);
  return `${what}(${detail})`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
