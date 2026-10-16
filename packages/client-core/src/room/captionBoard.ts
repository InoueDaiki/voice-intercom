import type { Caption } from "@voice-intercom/schema/voiceintercom/v1/caption_pb";

// 1つの言語の字幕の文。断片を連結し、確定が届いたら全文で置き換える。
export interface CaptionText {
  text: string;
  isFinal: boolean;
}

// 字幕の区切り(segment_id)1つ分。原文と各言語の訳をまとめて持つ。
export class CaptionSegment {
  readonly segmentId: string;
  readonly speakerIdentity: string;
  // 発話の単位。空なら segment_id が1つの発話にあたる(caption.proto)
  readonly utteranceId: string;
  readonly segmentIndex: number;
  // テキスト入力の字幕なら、送信者のアプリが振った message_id。音声の字幕なら空
  readonly messageId: string;
  // 最初の字幕が届いた時刻。表示の並びに使う
  readonly receivedAt: Date;

  // 原文の言語。分からなければ空
  originalLanguage = "";
  original: CaptionText | undefined;
  // 言語コード → 訳
  readonly translations = new Map<string, CaptionText>();

  // 送った本人が消したテキスト。本文と訳は捨て、「削除されたテキスト」と出す
  deleted = false;

  constructor(init: {
    segmentId: string;
    speakerIdentity: string;
    utteranceId: string;
    segmentIndex: number;
    messageId: string;
    receivedAt: Date;
  }) {
    this.segmentId = init.segmentId;
    this.speakerIdentity = init.speakerIdentity;
    this.utteranceId = init.utteranceId;
    this.segmentIndex = init.segmentIndex;
    this.messageId = init.messageId;
    this.receivedAt = init.receivedAt;
  }

  get isText(): boolean {
    return this.messageId !== "";
  }

  get isEmpty(): boolean {
    return (
      !this.deleted && !this.original?.text && [...this.translations.values()].every((t) => t.text === "")
    );
  }

  markDeleted(): void {
    this.deleted = true;
    this.original = undefined;
    this.translations.clear();
  }
}

// データチャネル(topic "caption")で届く Caption を、表示する字幕にまとめる。
//
// caption.proto の取り決め: (segment_id, language, translated) ごとに断片(is_final が false)を
// 連結して途中の字幕にし、確定(is_final が true)が届いたらその text で置き換える。
// 確定は最後に1回だけ届き、空なら字幕を消す。
export class CaptionBoard {
  // 持っておく区切りの上限。古いものから捨てる(過去の発言は履歴の画面で見る)
  readonly maxSegments: number;
  private readonly now: () => Date;
  // Map は入れた順を保つ
  private readonly segmentMap = new Map<string, CaptionSegment>();

  // 消したテキスト(送信者の identity と message_id)。後から届いた字幕(訳の途中など)で
  // 消したものを戻さないために持つ
  private readonly deletedKeys = new Set<string>();

  constructor(options: { maxSegments?: number; now?: () => Date } = {}) {
    this.maxSegments = options.maxSegments ?? 200;
    this.now = options.now ?? (() => new Date());
  }

  // 届いた順の区切り。空になったもの(確定が空)は除く
  get segments(): CaptionSegment[] {
    return [...this.segmentMap.values()].filter((s) => !s.isEmpty);
  }

  // テキスト入力を消したことにする(履歴で確かめた墓石から呼ぶ)。表示している字幕は
  // 「削除されたテキスト」になり、この後に届く字幕も本文を出さない。音声の字幕には使わない
  markTextDeleted(senderIdentity: string, messageId: string): void {
    if (messageId === "") {
      return;
    }
    this.deletedKeys.add(deletedKey(senderIdentity, messageId));
    for (const s of this.segmentMap.values()) {
      if (s.speakerIdentity === senderIdentity && s.messageId === messageId) {
        s.markDeleted();
      }
    }
  }

  apply(caption: Caption): void {
    if (caption.segmentId === "") {
      return;
    }
    let segment = this.segmentMap.get(caption.segmentId);
    if (!segment) {
      segment = new CaptionSegment({
        segmentId: caption.segmentId,
        speakerIdentity: caption.speakerIdentity,
        utteranceId: caption.utteranceId,
        segmentIndex: caption.segmentIndex,
        messageId: caption.messageId,
        receivedAt: this.now(),
      });
      if (caption.messageId !== "" && this.deletedKeys.has(deletedKey(caption.speakerIdentity, caption.messageId))) {
        segment.markDeleted();
      }
      this.segmentMap.set(caption.segmentId, segment);
    }
    if (segment.deleted) {
      return;
    }
    let current: CaptionText | undefined;
    if (caption.translated) {
      current = segment.translations.get(caption.language);
    } else {
      if (caption.language !== "") {
        segment.originalLanguage = caption.language;
      }
      current = segment.original;
    }
    let next: CaptionText;
    if (!current) {
      next = { text: caption.text, isFinal: caption.isFinal };
    } else if (current.isFinal) {
      // 確定の後に届いたものは取り決めの外なので、確定を保つ
      return;
    } else if (caption.isFinal) {
      next = { text: caption.text, isFinal: true };
    } else {
      next = { text: current.text + caption.text, isFinal: false };
    }
    if (caption.translated) {
      segment.translations.set(caption.language, next);
    } else {
      segment.original = next;
    }
    while (this.segmentMap.size > this.maxSegments) {
      const first = this.segmentMap.keys().next().value;
      if (first === undefined) {
        break;
      }
      this.segmentMap.delete(first);
    }
  }
}

function deletedKey(senderIdentity: string, messageId: string): string {
  return JSON.stringify([senderIdentity, messageId]);
}
