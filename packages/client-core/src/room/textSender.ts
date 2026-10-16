import { create } from "@bufbuild/protobuf";
import { type TextMessage, TextMessageSchema } from "@voice-intercom/schema/voiceintercom/v1/text_pb";
import {
  type TextStatus,
  TextStatus_Reason,
  TextStatus_State,
} from "@voice-intercom/schema/voiceintercom/v1/text_status_pb";

// 送ったテキストの状態。
export type OutgoingTextState =
  // 自分の message_id の字幕を待っている
  | "sending"
  // Agent が受け付けた(TextStatus の ACCEPTED か COMPLETED、または自分の message_id の字幕が届いた)
  | "delivered"
  // Agent が断った(長すぎる、など。TextStatus の REJECTED)
  | "rejected"
  // 受け付けたが、翻訳か読み上げの一部に失敗した(TextStatus の FAILED)
  | "processingFailed"
  // 送り直しても字幕も TextStatus も届かなかった
  | "failed";

export class OutgoingText {
  readonly messageId: string;
  readonly text: string;
  state: OutgoingTextState = "sending";
  attempts = 0;
  // 最後に届いた TextStatus(TextStatus を送らない古い Agent なら undefined のまま)
  status: TextStatus | undefined;

  /** @internal */ timer: unknown;
  // 送る順番は来たが、canSend が偽で送らずにいる
  /** @internal */ waiting = false;

  constructor(messageId: string, text: string) {
    this.messageId = messageId;
    this.text = text;
  }

  // Agent が受け付けて(ACCEPTED)、まだ結果(COMPLETED か FAILED)が届いていない
  get processing(): boolean {
    return this.state === "delivered" && this.status?.state === TextStatus_State.ACCEPTED;
  }
}

export interface TextSenderOptions {
  // データチャネルに送る。失敗したら例外を投げる(送り直しの対象になる)
  send: (message: TextMessage) => Promise<void>;
  onChanged: () => void;
  // 字幕も TextStatus も届かなければ送り直すまでの時間(ミリ秒)
  ackTimeoutMs?: number;
  maxAttempts?: number;
  // 今送ってよいか。偽なら送らずに待つ(resume で送る)
  canSend?: () => boolean;
  newMessageId?: () => string;
}

// テキスト入力(topic "text" の TextMessage)を送り、届かなければ送り直す。
//
// 入室の直後(ローカルの LiveKit では約3秒以内)に送ったテキストは、Agent に参加者の情報より先に
// 届くと、送信元が分からず捨てられる(設計メモの「Agent の結合確認」)。Agent は受け付けたら
// すぐに原文の字幕(message_id 付き)を配信するので、自分の message_id の字幕が ackTimeoutMs の
// うちに届かなければ、同じ message_id で送り直す。Agent は同じ (identity, message_id) を1回だけ
// 処理する。
//
// 受け手のアプリは、送信元が Agent の参加者の字幕しか読まない(RoomSession)。Agent が後から
// 入ったルームでは、アプリが Agent を知るまでの約3秒に届いた字幕は捨てられ、送り直しも Agent が
// 重複として捨てるので、字幕が返ってこない。そこで canSend が偽(Agent をまだ知らない)の間は
// 送らずに待ち、resume で送る。待つ間も送ったものとして数え、上限で諦める(Agent がいない)。
//
// Agent は受け付け・断り・結果を TextStatus(topic "text_status")で送信者だけに送る(applyStatus)。
// 字幕と TextStatus のどちらが届いても送り直しを止める(TextStatus を送らない古い Agent でも止まる)。
// 送り直しが Agent に届けば、Agent は処理をやり直さずに字幕と TextStatus を送り直すので、最初の
// 字幕を捨てていても止まる。
export class TextSender {
  private readonly send: (message: TextMessage) => Promise<void>;
  private readonly onChanged: () => void;
  readonly ackTimeoutMs: number;
  readonly maxAttempts: number;
  private readonly canSend: () => boolean;
  private readonly newMessageId: () => string;
  private readonly itemMap = new Map<string, OutgoingText>();
  private disposed = false;

  constructor(options: TextSenderOptions) {
    this.send = options.send;
    this.onChanged = options.onChanged;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 4000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.canSend = options.canSend ?? (() => true);
    this.newMessageId = options.newMessageId ?? randomMessageId;
  }

  // 送った順のテキスト
  get items(): OutgoingText[] {
    return [...this.itemMap.values()];
  }

  find(messageId: string): OutgoingText | undefined {
    return this.itemMap.get(messageId);
  }

  // テキストを送る。前後の空白を除いて空なら送らない
  submit(text: string): OutgoingText | undefined {
    const trimmed = text.trim();
    if (trimmed === "") {
      return undefined;
    }
    const item = new OutgoingText(this.newMessageId(), trimmed);
    this.itemMap.set(item.messageId, item);
    this.attempt(item);
    return item;
  }

  // 自分の送ったテキストの字幕が届いたら呼ぶ
  acknowledge(messageId: string): void {
    const item = this.itemMap.get(messageId);
    if (!item) {
      return;
    }
    this.settle(item, "delivered");
  }

  // Agent から自分の送ったテキストの TextStatus が届いたら呼ぶ
  applyStatus(status: TextStatus): void {
    const item = this.itemMap.get(status.messageId);
    if (!item) {
      return;
    }
    const next = stateOf(status.state);
    if (!next) {
      return;
    }
    // 結果が出た後に、送り直しへの ACCEPTED が遅れて届いても戻さない
    const settled = item.state === "rejected" || item.state === "processingFailed" || isFinal(item.status);
    if (settled && !isFinal(status)) {
      return;
    }
    item.status = status;
    this.settle(item, next, true);
  }

  // canSend が真になったら呼ぶ。待っていたものをすぐ送り、そこから ackTimeoutMs を数え直す
  resume(): void {
    if (this.disposed || !this.canSend()) {
      return;
    }
    for (const item of this.itemMap.values()) {
      if (item.waiting && item.state === "sending") {
        clearTimeout(item.timer);
        this.sendNow(item);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const item of this.itemMap.values()) {
      clearTimeout(item.timer);
    }
  }

  private settle(item: OutgoingText, next: OutgoingTextState, force = false): void {
    // 断られた・失敗したものは、字幕が届いても「届いた」に戻さない
    const keep = item.state === "rejected" || item.state === "processingFailed";
    if (!force && (keep || item.state === next)) {
      return;
    }
    clearTimeout(item.timer);
    item.waiting = false;
    item.state = next;
    this.onChanged();
  }

  private attempt(item: OutgoingText): void {
    item.attempts++;
    item.state = "sending";
    this.onChanged();
    if (this.canSend()) {
      this.sendNow(item);
    } else {
      item.waiting = true;
      this.startTimer(item);
    }
  }

  private sendNow(item: OutgoingText): void {
    item.waiting = false;
    // 送信の失敗も、字幕が届かなかったのと同じく時間切れで送り直す
    this.send(create(TextMessageSchema, { messageId: item.messageId, text: item.text })).catch(() => {});
    this.startTimer(item);
  }

  private startTimer(item: OutgoingText): void {
    item.timer = setTimeout(() => {
      if (this.disposed || item.state !== "sending") {
        return;
      }
      if (item.attempts >= this.maxAttempts) {
        item.state = "failed";
        this.onChanged();
        return;
      }
      this.attempt(item);
    }, this.ackTimeoutMs);
  }
}

function stateOf(state: TextStatus_State): OutgoingTextState | undefined {
  switch (state) {
    case TextStatus_State.ACCEPTED:
    case TextStatus_State.COMPLETED:
      return "delivered";
    case TextStatus_State.REJECTED:
      return "rejected";
    case TextStatus_State.FAILED:
      return "processingFailed";
    default:
      return undefined;
  }
}

function isFinal(s: TextStatus | undefined): boolean {
  return s !== undefined && s.state !== TextStatus_State.ACCEPTED;
}

// 128ビットの乱数の hex(UUID と同じ長さ)
export function randomMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// 送ったテキストの状態の表示。表示しないもの(届いて処理を終えた)は undefined
export function outgoingTextLabel(t: OutgoingText): string | undefined {
  switch (t.state) {
    case "sending":
      return `送信中(${t.attempts}回目)`;
    case "delivered":
      // 結果を待っている間だけ出す。結果を送らない古い Agent では、字幕が届いたら消す
      return t.processing ? "届いた" : undefined;
    case "rejected":
      return `断られた(${rejectReason(t.status)})`;
    case "processingFailed":
      return `失敗した(${failure(t.status)})`;
    case "failed":
      return "届かなかった";
  }
}

function rejectReason(s: TextStatus | undefined): string {
  switch (s?.reason) {
    case TextStatus_Reason.EMPTY:
      return "空のテキスト";
    case TextStatus_Reason.TOO_LONG: {
      const max = s.maxChars;
      return max > 0 ? `長すぎる。${max}文字まで` : "長すぎる";
    }
    default:
      return "理由不明";
  }
}

function failure(s: TextStatus | undefined): string {
  const parts: string[] = [];
  if (s && s.untranslatedLanguages.length > 0) {
    parts.push(`訳せなかった: ${s.untranslatedLanguages.join(", ")}`);
  }
  if (s && s.unspokenLanguages.length > 0) {
    parts.push(`読み上げられなかった: ${s.unspokenLanguages.join(", ")}`);
  }
  return parts.length === 0 ? "理由不明" : parts.join("、");
}
