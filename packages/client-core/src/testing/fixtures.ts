// テスト用の履歴の行と、データチャネルのメッセージ
import { create, toBinary } from "@bufbuild/protobuf";
import { CaptionSchema } from "@voice-intercom/schema/voiceintercom/v1/caption_pb";
import { DeletionMessageSchema } from "@voice-intercom/schema/voiceintercom/v1/deletion_pb";
import { MediaMessageSchema } from "@voice-intercom/schema/voiceintercom/v1/media_pb";

import type { TimelineEvent } from "../api.ts";

// 履歴の画像・動画の行
export function mediaEvent(
  occurredAt: string,
  options: {
    sourceId?: string;
    senderId?: string;
    video?: boolean;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    durationMs?: number;
  } = {},
): TimelineEvent {
  const sourceId = options.sourceId ?? "m1";
  return {
    room_id: "r1",
    event_id: `${occurredAt}#${sourceId}`,
    kind: "media",
    sender_id: options.senderId ?? "alice",
    occurred_at: occurredAt,
    language: null,
    text: "",
    translations: {},
    utterance_id: null,
    segment_index: null,
    media: {
      media_id: sourceId,
      content_type: options.video ? "video/mp4" : "image/jpeg",
      url: `https://media.example/rooms/r1/${sourceId}/original`,
      thumbnail_url: options.thumbnailUrl ?? null,
      size_bytes: 1234,
      width: options.width ?? null,
      height: options.height ?? null,
      duration_ms: options.durationMs ?? null,
    },
  };
}

// 履歴のテキストの行
export function textEvent(occurredAt: string, sourceId = "t1"): TimelineEvent {
  return {
    room_id: "r1",
    event_id: `${occurredAt}#${sourceId}`,
    kind: "text",
    sender_id: "alice",
    occurred_at: occurredAt,
    language: null,
    text: "はい",
    translations: {},
    utterance_id: null,
    segment_index: null,
    media: null,
  };
}

// 送ったテキストの行(既定は alice)
export function ownText(
  occurredAt: string,
  options: { sourceId?: string; senderId?: string; messageId?: string } = {},
): TimelineEvent {
  const sourceId = options.sourceId ?? "t1";
  return {
    room_id: "r1",
    event_id: `${occurredAt}#${sourceId}`,
    kind: "text",
    sender_id: options.senderId ?? "alice",
    occurred_at: occurredAt,
    language: "ja",
    text: "はい",
    translations: { en: "Yes" },
    utterance_id: null,
    segment_index: null,
    media: null,
    message_id: options.messageId ?? "m1",
  };
}

// 行を墓石にしたもの(API の DELETE の応答と同じ形)
export function tombstoneOf(row: TimelineEvent, video = false): TimelineEvent {
  return {
    ...row,
    text: "",
    translations: {},
    utterance_id: null,
    segment_index: null,
    media: null,
    deleted: {
      deleted_at: "2026-10-13T00:10:00.000Z",
      media_type: row.kind === "media" ? (video ? "video" : "image") : null,
    },
  };
}

// 履歴の行と同じ中身の MediaMessage(API が送るもの)
export function messageFor(e: TimelineEvent, override: { url?: string; senderIdentity?: string } = {}): Uint8Array {
  const media = e.media!;
  return toBinary(
    MediaMessageSchema,
    create(MediaMessageSchema, {
      eventId: e.event_id,
      senderIdentity: override.senderIdentity ?? e.sender_id,
      occurredAt: e.occurred_at,
      mediaId: media.media_id,
      contentType: media.content_type,
      url: override.url ?? media.url,
      thumbnailUrl: media.thumbnail_url ?? "",
      sizeBytes: BigInt(media.size_bytes),
      width: media.width ?? 0,
      height: media.height ?? 0,
      durationMs: media.duration_ms ?? 0,
    }),
  );
}

// 消した知らせ(API が topic deletion で送るもの)
export function deletionFor(row: TimelineEvent): Uint8Array {
  return toBinary(
    DeletionMessageSchema,
    create(DeletionMessageSchema, {
      eventId: row.event_id,
      senderIdentity: row.sender_id,
      kind: row.kind,
      messageId: row.message_id ?? "",
      deletedAt: "2026-10-13T00:10:00.000Z",
    }),
  );
}

// 待っている Promise の続き(マイクロタスク)と、0 ミリ秒のタイマーを流す
export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

// 字幕(Agent が topic caption で送るもの)
export function caption(
  segmentId: string,
  text: string,
  options: { language?: string; translated?: boolean; isFinal?: boolean; messageId?: string; speaker?: string } = {},
) {
  return create(CaptionSchema, {
    speakerIdentity: options.speaker ?? "speaker-1",
    segmentId,
    language: options.language ?? "ja",
    translated: options.translated ?? false,
    text,
    isFinal: options.isFinal ?? false,
    utteranceId: "u1",
    messageId: options.messageId ?? "",
  });
}
