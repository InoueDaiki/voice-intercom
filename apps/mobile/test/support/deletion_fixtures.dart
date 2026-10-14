import 'package:voice_intercom_api_client/api.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/deletion.pb.dart';

/// 送ったテキストの行(テスト用。既定は alice)
TimelineEvent ownText(
  String occurredAt, {
  String sourceId = 't1',
  String senderId = 'alice',
  String messageId = 'm1',
}) => TimelineEvent(
  roomId: 'r1',
  eventId: '$occurredAt#$sourceId',
  kind: TimelineEventKindEnum.text,
  senderId: senderId,
  occurredAt: occurredAt,
  language: TimelineEventLanguageEnum.ja,
  text: 'はい',
  translations: {'en': 'Yes'},
  utteranceId: null,
  segmentIndex: null,
  media: null,
  messageId: messageId,
);

/// 行を墓石にしたもの(API の DELETE の応答と同じ形)
TimelineEvent tombstoneOf(TimelineEvent row, {bool video = false}) =>
    TimelineEvent(
      roomId: row.roomId,
      eventId: row.eventId,
      kind: row.kind,
      senderId: row.senderId,
      occurredAt: row.occurredAt,
      language: row.language,
      text: '',
      translations: {},
      utteranceId: null,
      segmentIndex: null,
      media: null,
      messageId: row.messageId,
      deleted: TimelineDeletion(
        deletedAt: '2026-10-13T00:10:00.000Z',
        mediaType: row.kind == TimelineEventKindEnum.media
            ? (video
                  ? TimelineDeletionMediaTypeEnum.video
                  : TimelineDeletionMediaTypeEnum.image)
            : null,
      ),
    );

/// 消した知らせ(API が topic deletion で送るもの)
List<int> deletionFor(TimelineEvent row) => DeletionMessage(
  eventId: row.eventId,
  senderIdentity: row.senderId,
  kind: row.kind.toJson(),
  messageId: row.messageId ?? '',
  deletedAt: '2026-10-13T00:10:00.000Z',
).writeToBuffer();
