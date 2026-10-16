import { fromBinary } from "@bufbuild/protobuf";
import { type DeletionMessage, DeletionMessageSchema } from "@voice-intercom/schema/voiceintercom/v1/deletion_pb";

import type { TimelineEvent } from "../api.ts";

// 受け取った `DeletionMessage` をどうしたか(テストとログのため)
export type DeletionReceiveResult =
  // 履歴で確かめる(確かめたら onConfirmed に渡す)
  | "checking"
  // 送信元の参加者があった(参加者が送ったもの。topic を偽れるので捨てる)
  | "fromParticipant"
  // `DeletionMessage` として読めない、または event_id が空
  | "invalid"
  // もう反映している、または確かめている途中(DELETE のやり直し、自分の削除)
  | "duplicate"
  // 確かめ待ちが多すぎる
  | "overflow";

export interface DeletionReceiverOptions {
  // 履歴の1件を読む。無ければ null
  fetchEvent: (eventId: string) => Promise<TimelineEvent | null>;
  // 確かめた墓石を渡す(表示を「削除された…」に変える)
  onConfirmed: (tombstone: TimelineEvent) => void;
  // もう墓石を反映している event_id か
  isApplied: (eventId: string) => boolean;
  // 読めなかったときに読み直すまでの間隔(ミリ秒)。長さが読み直しの回数
  retryDelaysMs?: number[];
  // 確かめ待ちの上限。超えたものは捨てる(入り直すか履歴を開けば反映される)
  maxPending?: number;
}

// データチャネル(topic `deletion`)の `DeletionMessage` を、履歴で確かめてから表示に渡す。
//
// 画像・動画の配信(`MediaReceiver`)と同じく、送信元の参加者が無いというだけでは API から来たと
// 言えない(入った直後の参加者が送ったものも送信元なしで届く)。そこで `DeletionMessage` は
// 「行が消された」という知らせとして扱い、`GET /rooms/{room_id}/timeline/event` で event_id の行を
// 読み、消されている(`deleted` がある)ときだけ、その行(墓石)を渡す。表示を変えるのに使う送信者と
// message_id も行のものなので、偽の知らせで他人のものを消したように見せることはできない
// (行を消せるのは送った本人だけ)。
//
// 1件の取得は強い整合の読み取りなので、行が消されていなければ偽の知らせとみなして捨てる。
// 読めなかった(通信の失敗など)ときだけ retryDelaysMs の間隔で読み直す。
export class DeletionReceiver {
  private readonly fetchEvent: (eventId: string) => Promise<TimelineEvent | null>;
  private readonly onConfirmed: (tombstone: TimelineEvent) => void;
  private readonly isApplied: (eventId: string) => boolean;
  readonly retryDelaysMs: number[];
  readonly maxPending: number;

  private readonly pending = new Set<string>();
  private readonly timers = new Set<unknown>();
  private disposed = false;

  constructor(options: DeletionReceiverOptions) {
    this.fetchEvent = options.fetchEvent;
    this.onConfirmed = options.onConfirmed;
    this.isApplied = options.isApplied;
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 3000];
    this.maxPending = options.maxPending ?? 50;
  }

  // 確かめ待ちの件数(テスト用)
  get pendingCount(): number {
    return this.pending.size;
  }

  // データチャネルで受け取った。fromParticipant は送信元の参加者があるか
  receive(data: Uint8Array, fromParticipant: boolean): DeletionReceiveResult {
    if (this.disposed) {
      return "invalid";
    }
    if (fromParticipant) {
      return "fromParticipant";
    }
    let message: DeletionMessage;
    try {
      message = fromBinary(DeletionMessageSchema, data);
    } catch {
      return "invalid";
    }
    const eventId = message.eventId;
    if (eventId === "") {
      return "invalid";
    }
    if (this.isApplied(eventId) || this.pending.has(eventId)) {
      return "duplicate";
    }
    if (this.pending.size >= this.maxPending) {
      return "overflow";
    }
    this.pending.add(eventId);
    void this.check(eventId, 0);
    return "checking";
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers.clear();
    this.pending.clear();
  }

  private async check(eventId: string, attempt: number): Promise<void> {
    let row: TimelineEvent | null;
    try {
      row = await this.fetchEvent(eventId);
    } catch (e) {
      if (this.disposed) {
        return;
      }
      if (attempt >= this.retryDelaysMs.length) {
        this.pending.delete(eventId);
        console.warn("消した知らせを確かめられなかった", eventId, e);
        return;
      }
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        if (!this.disposed) {
          void this.check(eventId, attempt + 1);
        }
      }, this.retryDelaysMs[attempt]);
      this.timers.add(timer);
      return;
    }
    if (this.disposed) {
      return;
    }
    this.pending.delete(eventId);
    if (!row || row.deleted == null || row.event_id !== eventId) {
      console.info("履歴で消されていない行の知らせを捨てた", eventId);
      return;
    }
    this.onConfirmed(row);
  }
}
