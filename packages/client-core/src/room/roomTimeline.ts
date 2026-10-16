import type { TimelineEvent, TimelinePage } from "../api.ts";
import type { CaptionBoard, CaptionSegment, CaptionText } from "./captionBoard.ts";

// ルームの画面の時間の流れ。履歴の行(発話、テキスト、画像・動画・ファイル)と、入室してから
// データチャネルで届いた字幕を、1本のタイムラインとして同じ形で見せる(設計メモの
// 「1つのタイムライン」)。
//
// - 履歴の行は event_id で持ち、重ねない。入室とつなぎ直しで新しいほうを読み(syncLatest)、
//   上へ戻ると古いほうを読み足す(loadOlder)。
// - 字幕は、履歴に同じ区切りの行が入ったら、行のほうを出す。Agent は字幕の segment_id を
//   履歴の source_id(event_id の `#` の後ろ)にして保存するので、それで突き合わせる。
//   行が無いうちは(Agent は訳がそろってから保存する)、字幕をそのまま出す。
// - 墓石(送った本人が消した行)は、もとの行を置き換える。墓石を消していない行で戻すことはしない
//   (古い応答や遅れた complete の応答が後から届いても、消したものを戻さない)。

// タイムラインの1件。字幕と、履歴のテキスト・発話の行は、同じ形(caption)にして出す
export type TimelineEntry =
  | {
      type: "caption";
      key: string;
      at: Date;
      speakerIdentity: string;
      // テキスト入力なら true。音声の発話なら false
      isText: boolean;
      // 原文の言語。分からなければ空
      originalLanguage: string;
      original: CaptionText | undefined;
      // 言語コード → 訳
      translations: ReadonlyMap<string, CaptionText>;
      deleted: boolean;
      // 字幕から作ったもの(まだ履歴に無い)なら、その区切り
      segment: CaptionSegment | undefined;
      // 履歴の行から作ったものなら、その行
      event: TimelineEvent | undefined;
    }
  | { type: "media"; key: string; at: Date; event: TimelineEvent };

export interface RoomTimelineOptions {
  // 履歴の1ページ(新しい順)。before より古いもの。before が無ければ最新のページ
  fetchPage: (before: string | undefined) => Promise<TimelinePage>;
  // 状態が変わったら呼ぶ
  onChanged: () => void;
  // つなぎ直しで、知っている行に届くまで読む最大のページ数
  maxGapPages?: number;
}

export class RoomTimeline {
  private readonly fetchPage: (before: string | undefined) => Promise<TimelinePage>;
  private readonly onChanged: () => void;
  readonly maxGapPages: number;
  private readonly rows = new Map<string, TimelineEvent>();
  // 履歴にある区切り(source_id)。字幕と突き合わせる
  private readonly sourceIds = new Set<string>();
  // 古いほうの続き。undefined はまだ読んでいない、null はもう無い
  private olderCursor: string | null | undefined;
  private olderLoading: Promise<void> | undefined;
  private syncing: Promise<void> | undefined;
  // 読み込みの失敗(画面に出す)
  error: string | undefined;

  constructor(options: RoomTimelineOptions) {
    this.fetchPage = options.fetchPage;
    this.onChanged = options.onChanged;
    this.maxGapPages = options.maxGapPages ?? 5;
  }

  // 古いほうにまだ行があるか(まだ1回も読んでいなければ true)
  get hasOlder(): boolean {
    return this.olderCursor !== null;
  }

  get loadingOlder(): boolean {
    return this.olderLoading !== undefined;
  }

  // 一度でも履歴を読んだか
  get loaded(): boolean {
    return this.olderCursor !== undefined;
  }

  get(eventId: string): TimelineEvent | undefined {
    return this.rows.get(eventId);
  }

  contains(eventId: string): boolean {
    return this.rows.has(eventId);
  }

  // 消した行(墓石)を持っているか
  isDeleted(eventId: string): boolean {
    return this.rows.get(eventId)?.deleted != null;
  }

  // 画像・動画・ファイルの行(古い順)
  get media(): TimelineEvent[] {
    return this.sortedRows().filter((r) => r.kind === "media");
  }

  // 足す。もうある行は、墓石でだけ置き換える。足したか置き換えたら true
  add(row: TimelineEvent): boolean {
    if (row.kind === "media" && row.media == null && row.deleted == null) {
      return false;
    }
    const current = this.rows.get(row.event_id);
    if (current && (current.deleted != null || row.deleted == null)) {
      return false;
    }
    this.rows.set(row.event_id, row);
    this.sourceIds.add(sourceIdOf(row.event_id));
    return true;
  }

  // まとめて足す。1件でも変われば true
  addAll(rows: Iterable<TimelineEvent>): boolean {
    let changed = false;
    for (const r of rows) {
      changed = this.add(r) || changed;
    }
    return changed;
  }

  // 最新のページを読む(入室とつなぎ直し)。つないでいなかった間の行が1ページに収まらなければ、
  // 知っている行に届くまで古いほうへ読む(maxGapPages まで。それより古い抜けは、上へ戻ったときにも
  // 埋まらない。続きの位置は最初に読んだときのまま)
  syncLatest(): Promise<void> {
    this.syncing ??= this.runSync().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    const first = !this.loaded;
    let before: string | undefined;
    try {
      for (let i = 0; i < this.maxGapPages; i++) {
        const page = await this.fetchPage(before);
        const known = page.items.some((r) => this.rows.has(r.event_id));
        this.addAll(page.items);
        if (first) {
          // 初めて読んだときは、続きの位置を覚えて終わる(古いほうは上へ戻ったときに読む)
          this.olderCursor = page.next_before;
          break;
        }
        if (known || page.next_before === null) {
          break;
        }
        before = page.next_before;
      }
      this.error = undefined;
    } catch (e) {
      this.error = `履歴を読めなかった: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.onChanged();
  }

  // 古いほうを1ページ読み足す。読んでいる途中なら、それを待つ
  loadOlder(): Promise<void> {
    if (this.olderCursor === null) {
      return Promise.resolve();
    }
    if (this.olderCursor === undefined) {
      return this.syncLatest();
    }
    this.olderLoading ??= this.runOlder(this.olderCursor).finally(() => {
      this.olderLoading = undefined;
      this.onChanged();
    });
    this.onChanged();
    return this.olderLoading;
  }

  private async runOlder(before: string): Promise<void> {
    try {
      const page = await this.fetchPage(before);
      this.addAll(page.items);
      this.olderCursor = page.next_before;
      this.error = undefined;
    } catch (e) {
      this.error = `履歴を読めなかった: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 消したテキストの行(字幕を「削除されたテキスト」にするのに使う)
  deletedTexts(): TimelineEvent[] {
    return [...this.rows.values()].filter((r) => r.kind === "text" && r.deleted != null);
  }

  // 履歴にもう同じ区切りの行があるか(あれば字幕ではなく行を出す)
  hasRowFor(segmentId: string): boolean {
    return this.sourceIds.has(segmentId);
  }

  // 自分の送ったテキストの行を、message_id で探す
  findText(senderIdentity: string, messageId: string): TimelineEvent | undefined {
    for (const r of this.rows.values()) {
      if (r.kind === "text" && r.sender_id === senderIdentity && r.message_id === messageId) {
        return r;
      }
    }
    return undefined;
  }

  // 字幕と行を、時刻の順(古い順)に並べる。行は occurred_at(サーバーの時刻)、字幕は届いた時刻
  // なので、端末の時計がずれていれば前後しうる。同じ時刻なら、行を先に、それぞれ元の並びのまま
  entries(captions: CaptionBoard): TimelineEntry[] {
    const list: TimelineEntry[] = this.sortedRows().map(rowEntry);
    for (const segment of captions.segments) {
      if (!this.sourceIds.has(segment.segmentId)) {
        list.push(segmentEntry(segment));
      }
    }
    // sort は安定なので、同じ時刻なら元の並びを保つ
    return list.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private sortedRows(): TimelineEvent[] {
    return [...this.rows.values()].sort((a, b) => (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));
  }
}

// event_id(`<occurred_at>#<source_id>`)の source_id
export function sourceIdOf(eventId: string): string {
  const i = eventId.indexOf("#");
  return i < 0 ? eventId : eventId.slice(i + 1);
}

function timeOf(row: TimelineEvent): Date {
  const t = Date.parse(row.occurred_at);
  return new Date(Number.isNaN(t) ? 0 : t);
}

function rowEntry(row: TimelineEvent): TimelineEntry {
  if (row.kind === "media") {
    return { type: "media", key: row.event_id, at: timeOf(row), event: row };
  }
  const translations = new Map<string, CaptionText>(
    Object.entries(row.translations).map(([lang, text]) => [lang, { text, isFinal: true }]),
  );
  return {
    type: "caption",
    // event_id は重ならない(同じ区切りの字幕が行に替わると key が変わり、描き直しになる)
    key: row.event_id,
    at: timeOf(row),
    speakerIdentity: row.sender_id,
    isText: row.kind === "text",
    originalLanguage: row.language ?? "",
    original: row.deleted == null ? { text: row.text, isFinal: true } : undefined,
    translations,
    deleted: row.deleted != null,
    segment: undefined,
    event: row,
  };
}

function segmentEntry(segment: CaptionSegment): TimelineEntry {
  return {
    type: "caption",
    key: segment.segmentId,
    at: segment.receivedAt,
    speakerIdentity: segment.speakerIdentity,
    isText: segment.isText,
    originalLanguage: segment.originalLanguage,
    original: segment.original,
    translations: segment.translations,
    deleted: segment.deleted,
    segment,
    event: undefined,
  };
}
