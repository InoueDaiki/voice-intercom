import { fromBinary } from "@bufbuild/protobuf";
import { type MediaMessage, MediaMessageSchema } from "@voice-intercom/schema/voiceintercom/v1/media_pb";

import type { TimelineEvent } from "../api.ts";

// 受け取った `MediaMessage` をどうしたか(テストとログのため)
export type MediaReceiveResult =
  // 履歴で確かめる(確かめたら onConfirmed に渡す)
  | "checking"
  // 送信元の参加者があった(参加者が送ったもの。topic を偽れるので捨てる)
  | "fromParticipant"
  // `MediaMessage` として読めない、または event_id が空
  | "invalid"
  // もう表示している、または確かめている途中(complete のやり直し、自分の送信)
  | "duplicate"
  // 確かめ待ちが多すぎる
  | "overflow";

export interface MediaReceiverOptions {
  // 履歴の先頭のページ(新しい順)を読む
  fetchRecent: () => Promise<TimelineEvent[]>;
  // 確かめた履歴の行を渡す(ルームの表示に足す)
  onConfirmed: (events: TimelineEvent[]) => void;
  // もう表示している event_id か
  isKnown: (eventId: string) => boolean;
  // 見つからなかったときに読み直すまでの間隔(ミリ秒)。長さが読み直しの回数
  retryDelaysMs?: number[];
  // 確かめ待ちの上限。超えたものは捨てる(履歴を開けば見られる)
  maxPending?: number;
}

// データチャネル(topic `media`)の `MediaMessage` を、履歴で確かめてからルームの表示に渡す。
//
// 送信元の参加者が無いというだけでは、API(Server API)から来たとは言えない。受け手が
// 新しい参加者を知るまでの約3秒は、参加者が送ったデータも送信元なしで届く(設計メモの
// 「サーバー側の確認」。livekit-client も、データの identity を remoteParticipants で引き、
// 知らなければ undefined にする)。そこで `MediaMessage` は「履歴に新しい行がある」という
// 知らせとして扱い、`GET /rooms/{room_id}/timeline` の先頭のページで event_id の行を確かめ、
// 表示には履歴の行を使う(無ければ捨てる)。
//
// - 履歴を読むのは同時に1回だけ。読んでいる間に届いたものは、読み終えてからまとめて確かめる
//   (たくさん届いても、履歴を読む回数は増えすぎない)。
// - 履歴の読み込みは DynamoDB の結果整合の読み取りなので、保存の直後は行がまだ見えないことがある。
//   見つからなければ retryDelaysMs の間隔で読み直し、それでも無ければ捨てる。
export class MediaReceiver {
  private readonly fetchRecent: () => Promise<TimelineEvent[]>;
  private readonly onConfirmed: (events: TimelineEvent[]) => void;
  private readonly isKnown: (eventId: string) => boolean;
  readonly retryDelaysMs: number[];
  readonly maxPending: number;

  // 確かめ待ちの event_id と、見つからなかった回数
  private readonly pending = new Map<string, number>();
  // 次の読み込みで確かめるもの(届いたばかりか、読み直しの時刻が来たもの)
  private readonly due = new Set<string>();
  private readonly timers = new Set<unknown>();
  private fetching = false;
  private again = false;
  private disposed = false;

  constructor(options: MediaReceiverOptions) {
    this.fetchRecent = options.fetchRecent;
    this.onConfirmed = options.onConfirmed;
    this.isKnown = options.isKnown;
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 3000];
    this.maxPending = options.maxPending ?? 50;
  }

  // 確かめ待ちの件数(テスト用)
  get pendingCount(): number {
    return this.pending.size;
  }

  // データチャネルで受け取った。fromParticipant は送信元の参加者があるか
  receive(data: Uint8Array, fromParticipant: boolean): MediaReceiveResult {
    if (this.disposed) {
      return "invalid";
    }
    if (fromParticipant) {
      return "fromParticipant";
    }
    let message: MediaMessage;
    try {
      message = fromBinary(MediaMessageSchema, data);
    } catch {
      return "invalid";
    }
    const eventId = message.eventId;
    if (eventId === "") {
      return "invalid";
    }
    if (this.isKnown(eventId) || this.pending.has(eventId)) {
      return "duplicate";
    }
    if (this.pending.size >= this.maxPending) {
      return "overflow";
    }
    this.pending.set(eventId, 0);
    this.due.add(eventId);
    this.fetch();
    return "checking";
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers.clear();
    this.pending.clear();
    this.due.clear();
  }

  private fetch(): void {
    if (this.fetching) {
      this.again = true;
      return;
    }
    this.fetching = true;
    void this.run();
  }

  private async run(): Promise<void> {
    try {
      do {
        this.again = false;
        // 読み始めた時点で待っているものだけを、この読み込みで確かめる。
        // 読んでいる間に届いたものは、行がまだ無いかもしれないので次の読み込みで確かめる
        const checking = new Set(this.due);
        this.due.clear();
        let rows: TimelineEvent[] = [];
        try {
          rows = await this.fetchRecent();
        } catch (e) {
          console.warn("履歴を読めなかった(画像・動画の確かめ)", e);
        }
        if (this.disposed) {
          return;
        }
        const byId = new Map(rows.map((r) => [r.event_id, r]));
        const confirmed: TimelineEvent[] = [];
        // 読み直しを待っているものも、行があれば確かめられたことにする
        for (const id of [...this.pending.keys()]) {
          const row = byId.get(id);
          if (row && row.media != null) {
            this.pending.delete(id);
            this.due.delete(id);
            confirmed.push(row);
          } else if (checking.has(id)) {
            this.missed(id);
          }
        }
        if (confirmed.length > 0) {
          this.onConfirmed(confirmed);
        }
      } while (this.again && !this.disposed);
    } finally {
      this.fetching = false;
    }
  }

  // 見つからなかった(または読めなかった)。間を置いて読み直すか、捨てる
  private missed(eventId: string): void {
    const misses = (this.pending.get(eventId) ?? 0) + 1;
    if (misses > this.retryDelaysMs.length) {
      this.pending.delete(eventId);
      console.info("履歴に無い画像・動画の知らせを捨てた", eventId);
      return;
    }
    this.pending.set(eventId, misses);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed && this.pending.has(eventId)) {
        this.due.add(eventId);
        this.fetch();
      }
    }, this.retryDelaysMs[misses - 1]);
    this.timers.add(timer);
  }
}
