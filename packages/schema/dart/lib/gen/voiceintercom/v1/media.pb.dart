// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/media.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// 画像・動画。API が complete(POST /rooms/{room_id}/media/{media_id}/complete)で履歴に
/// 保存した後に、LiveKit の Server API(RoomService.SendData)からデータチャネル
/// (topic は "media"、reliable)でルームの全員に配信する。
///
/// 中身は保存した履歴(GET /rooms/{room_id}/timeline の kind が media の行)と同じ。
/// 送信者はメッセージの sender_identity で表す。LiveKit の送信元の参加者は無い(サーバーから送るため)。
/// 受け手は、送信元の参加者があるもの(参加者が送ったもの)を捨てる。参加者は topic を偽れるため。
/// 同じ event_id が2回以上届くことがある(complete のやり直し)。受け手は event_id で重複を捨てる。
///
/// 項目を足すときは番号を足すだけにする。名前の変更と番号の使い回しはしない(消すときは reserved)。
class MediaMessage extends $pb.GeneratedMessage {
  factory MediaMessage({
    $core.String? eventId,
    $core.String? senderIdentity,
    $core.String? occurredAt,
    $core.String? mediaId,
    $core.String? contentType,
    $core.String? url,
    $core.String? thumbnailUrl,
    $fixnum.Int64? sizeBytes,
    @$core.Deprecated('This field is deprecated.') $core.String? text,
    @$core.Deprecated('This field is deprecated.') $core.bool? textTruncated,
    @$core.Deprecated('This field is deprecated.') $core.String? language,
    $core.int? width,
    $core.int? height,
    $core.int? durationMs,
  }) {
    final result = MediaMessage._();
    if (eventId != null) result.eventId = eventId;
    if (senderIdentity != null) result.senderIdentity = senderIdentity;
    if (occurredAt != null) result.occurredAt = occurredAt;
    if (mediaId != null) result.mediaId = mediaId;
    if (contentType != null) result.contentType = contentType;
    if (url != null) result.url = url;
    if (thumbnailUrl != null) result.thumbnailUrl = thumbnailUrl;
    if (sizeBytes != null) result.sizeBytes = sizeBytes;
    if (text != null) result.text = text;
    if (textTruncated != null) result.textTruncated = textTruncated;
    if (language != null) result.language = language;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (durationMs != null) result.durationMs = durationMs;
    return result;
  }

  MediaMessage._();

  factory MediaMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MediaMessage()..mergeFromBuffer(data, registry);
  factory MediaMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MediaMessage()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MediaMessage',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'voiceintercom.v1'),
      createEmptyInstance: MediaMessage.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'eventId')
    ..aOS(2, _omitFieldNames ? '' : 'senderIdentity')
    ..aOS(3, _omitFieldNames ? '' : 'occurredAt')
    ..aOS(4, _omitFieldNames ? '' : 'mediaId')
    ..aOS(5, _omitFieldNames ? '' : 'contentType')
    ..aOS(6, _omitFieldNames ? '' : 'url')
    ..aOS(7, _omitFieldNames ? '' : 'thumbnailUrl')
    ..a<$fixnum.Int64>(
        8, _omitFieldNames ? '' : 'sizeBytes', $pb.PbFieldType.OU6,
        defaultOrMaker: $fixnum.Int64.ZERO)
    ..aOS(9, _omitFieldNames ? '' : 'text')
    ..aOB(10, _omitFieldNames ? '' : 'textTruncated')
    ..aOS(11, _omitFieldNames ? '' : 'language')
    ..aI(12, _omitFieldNames ? '' : 'width', fieldType: $pb.PbFieldType.OU3)
    ..aI(13, _omitFieldNames ? '' : 'height', fieldType: $pb.PbFieldType.OU3)
    ..aI(14, _omitFieldNames ? '' : 'durationMs',
        fieldType: $pb.PbFieldType.OU3)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MediaMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MediaMessage copyWith(void Function(MediaMessage) updates) =>
      super.copyWith((message) => updates(message as MediaMessage))
          as MediaMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use MediaMessage() / MediaMessage.new instead')
  static MediaMessage create() => MediaMessage._();
  static $pb.GeneratedMessage $_createMessage() => MediaMessage._();
  @$core.override
  MediaMessage createEmptyInstance() => MediaMessage._();
  @$core.pragma('dart2js:noInline')
  static MediaMessage getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<MediaMessage>(
          MediaMessage.$_createMessage);
  static MediaMessage? _defaultInstance;

  /// 履歴の event_id(`<occurred_at>#<source_id>`)。重複の排除と、履歴との突き合わせに使う
  @$pb.TagNumber(1)
  $core.String get eventId => $_getSZ(0);
  @$pb.TagNumber(1)
  set eventId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEventId() => $_has(0);
  @$pb.TagNumber(1)
  void clearEventId() => $_clearField(1);

  /// 送信者の LiveKit identity(履歴の sender_id。Cognito の sub)
  @$pb.TagNumber(2)
  $core.String get senderIdentity => $_getSZ(1);
  @$pb.TagNumber(2)
  set senderIdentity($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSenderIdentity() => $_has(1);
  @$pb.TagNumber(2)
  void clearSenderIdentity() => $_clearField(2);

  /// 保存した時刻。ISO 8601(UTC、ミリ秒まで。例 2026-10-10T00:00:00.000Z)
  @$pb.TagNumber(3)
  $core.String get occurredAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set occurredAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasOccurredAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearOccurredAt() => $_clearField(3);

  /// uploads が返した media_id
  @$pb.TagNumber(4)
  $core.String get mediaId => $_getSZ(3);
  @$pb.TagNumber(4)
  set mediaId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMediaId() => $_has(3);
  @$pb.TagNumber(4)
  void clearMediaId() => $_clearField(4);

  /// MIME タイプ(image/jpeg、image/png、image/webp、image/heic、video/mp4)
  @$pb.TagNumber(5)
  $core.String get contentType => $_getSZ(4);
  @$pb.TagNumber(5)
  set contentType($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasContentType() => $_has(4);
  @$pb.TagNumber(5)
  void clearContentType() => $_clearField(5);

  /// 表示・再生の URL(CloudFront)
  @$pb.TagNumber(6)
  $core.String get url => $_getSZ(5);
  @$pb.TagNumber(6)
  set url($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasUrl() => $_has(5);
  @$pb.TagNumber(6)
  void clearUrl() => $_clearField(6);

  /// サムネイル(image/jpeg)の URL。なければ空
  @$pb.TagNumber(7)
  $core.String get thumbnailUrl => $_getSZ(6);
  @$pb.TagNumber(7)
  set thumbnailUrl($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasThumbnailUrl() => $_has(6);
  @$pb.TagNumber(7)
  void clearThumbnailUrl() => $_clearField(7);

  /// 本体のバイト数(実際に置かれた大きさ)
  @$pb.TagNumber(8)
  $fixnum.Int64 get sizeBytes => $_getI64(7);
  @$pb.TagNumber(8)
  set sizeBytes($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasSizeBytes() => $_has(7);
  @$pb.TagNumber(8)
  void clearSizeBytes() => $_clearField(8);

  /// 使わない(常に空)。画像・動画には文を添えられない(2026-10-13 に決めた。設計メモの
  /// 「画像・動画のルームへの配信」)。古いアプリが読むので項目は残す
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(9)
  $core.String get text => $_getSZ(8);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(9)
  set text($core.String value) => $_setString(8, value);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(9)
  $core.bool hasText() => $_has(8);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(9)
  void clearText() => $_clearField(9);

  /// 使わない(常に false)。text と同じ
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(10)
  $core.bool get textTruncated => $_getBF(9);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(10)
  set textTruncated($core.bool value) => $_setBool(9, value);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(10)
  $core.bool hasTextTruncated() => $_has(9);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(10)
  void clearTextTruncated() => $_clearField(10);

  /// 使わない(常に空)。添えた文の言語だったもの。text と同じ
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(11)
  $core.String get language => $_getSZ(10);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(11)
  set language($core.String value) => $_setString(10, value);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(11)
  $core.bool hasLanguage() => $_has(10);
  @$core.Deprecated('This field is deprecated.')
  @$pb.TagNumber(11)
  void clearLanguage() => $_clearField(11);

  /// 表示の幅と高さ(ピクセル。向きを反映した後の値。縦向きなら height が大きい)。
  /// 送信者のアプリが整えた後の本体で測った値。分からなければ 0(古いアプリが上げたもの、
  /// 管理コンソールから上げたものなど)。受け手は 0 なら決まった枠で表示する
  @$pb.TagNumber(12)
  $core.int get width => $_getIZ(11);
  @$pb.TagNumber(12)
  set width($core.int value) => $_setUnsignedInt32(11, value);
  @$pb.TagNumber(12)
  $core.bool hasWidth() => $_has(11);
  @$pb.TagNumber(12)
  void clearWidth() => $_clearField(12);

  @$pb.TagNumber(13)
  $core.int get height => $_getIZ(12);
  @$pb.TagNumber(13)
  set height($core.int value) => $_setUnsignedInt32(12, value);
  @$pb.TagNumber(13)
  $core.bool hasHeight() => $_has(12);
  @$pb.TagNumber(13)
  void clearHeight() => $_clearField(13);

  /// 動画の長さ(ミリ秒)。画像と、分からないときは 0
  @$pb.TagNumber(14)
  $core.int get durationMs => $_getIZ(13);
  @$pb.TagNumber(14)
  set durationMs($core.int value) => $_setUnsignedInt32(13, value);
  @$pb.TagNumber(14)
  $core.bool hasDurationMs() => $_has(13);
  @$pb.TagNumber(14)
  void clearDurationMs() => $_clearField(14);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
