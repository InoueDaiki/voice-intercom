import 'package:voice_intercom_api_client/api.dart';

/// 履歴の画像・動画の行(テスト用)
TimelineEvent mediaEvent(
  String occurredAt, {
  String sourceId = 'm1',
  String senderId = 'alice',
  bool video = false,
  String? thumbnailUrl,
  String text = '',
}) => TimelineEvent(
  roomId: 'r1',
  eventId: '$occurredAt#$sourceId',
  kind: TimelineEventKindEnum.media,
  senderId: senderId,
  occurredAt: occurredAt,
  language: null,
  text: text,
  utteranceId: null,
  segmentIndex: null,
  media: TimelineMedia(
    mediaId: sourceId,
    contentType: video
        ? TimelineMediaContentTypeEnum.videoSlashMp4
        : TimelineMediaContentTypeEnum.imageSlashJpeg,
    url: 'https://media.example/rooms/r1/$sourceId/original',
    thumbnailUrl: thumbnailUrl,
    sizeBytes: 1234,
  ),
);

/// 履歴のテキストの行(テスト用)
TimelineEvent textEvent(String occurredAt, {String sourceId = 't1'}) =>
    TimelineEvent(
      roomId: 'r1',
      eventId: '$occurredAt#$sourceId',
      kind: TimelineEventKindEnum.text,
      senderId: 'alice',
      occurredAt: occurredAt,
      language: null,
      text: 'はい',
      utteranceId: null,
      segmentIndex: null,
      media: null,
    );
