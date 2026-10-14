// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/deletion.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// 履歴の行(テキスト入力、画像・動画)を送った本人が消した知らせ。API が
/// DELETE /rooms/{room_id}/timeline/event で行を墓石にした後に、LiveKit の Server API
/// (RoomService.SendData)からデータチャネル(topic は "deletion"、reliable)でルームの全員に配信する。
///
/// 受け手は、送信元の参加者があるもの(参加者が送ったもの)を捨てる。参加者は topic を偽れるため。
/// 送信元の参加者が無いだけでは、サーバーから来たとは言えない(入った直後の参加者が送ったものも
/// 無しで届く)。受け手は、これを「行が消された」という知らせとして扱い、
/// GET /rooms/{room_id}/timeline/event で event_id の行が消されていることを確かめてから、
/// 表示を「削除された…」に変える。表示に使う送信者や message_id も、履歴の行のものを使う。
/// 同じ event_id が2回以上届くことがある(DELETE のやり直し)。
///
/// 項目を足すときは番号を足すだけにする。名前の変更と番号の使い回しはしない(消すときは reserved)。
class DeletionMessage extends $pb.GeneratedMessage {
  factory DeletionMessage({
    $core.String? eventId,
    $core.String? senderIdentity,
    $core.String? kind,
    $core.String? messageId,
    $core.String? deletedAt,
  }) {
    final result = DeletionMessage._();
    if (eventId != null) result.eventId = eventId;
    if (senderIdentity != null) result.senderIdentity = senderIdentity;
    if (kind != null) result.kind = kind;
    if (messageId != null) result.messageId = messageId;
    if (deletedAt != null) result.deletedAt = deletedAt;
    return result;
  }

  DeletionMessage._();

  factory DeletionMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeletionMessage()..mergeFromBuffer(data, registry);
  factory DeletionMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeletionMessage()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeletionMessage',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'voiceintercom.v1'),
      createEmptyInstance: DeletionMessage.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'eventId')
    ..aOS(2, _omitFieldNames ? '' : 'senderIdentity')
    ..aOS(3, _omitFieldNames ? '' : 'kind')
    ..aOS(4, _omitFieldNames ? '' : 'messageId')
    ..aOS(5, _omitFieldNames ? '' : 'deletedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletionMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletionMessage copyWith(void Function(DeletionMessage) updates) =>
      super.copyWith((message) => updates(message as DeletionMessage))
          as DeletionMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use DeletionMessage() / DeletionMessage.new instead')
  static DeletionMessage create() => DeletionMessage._();
  static $pb.GeneratedMessage $_createMessage() => DeletionMessage._();
  @$core.override
  DeletionMessage createEmptyInstance() => DeletionMessage._();
  @$core.pragma('dart2js:noInline')
  static DeletionMessage getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<DeletionMessage>(
          DeletionMessage.$_createMessage);
  static DeletionMessage? _defaultInstance;

  /// 消した履歴の行の event_id(`<occurred_at>#<source_id>`)
  @$pb.TagNumber(1)
  $core.String get eventId => $_getSZ(0);
  @$pb.TagNumber(1)
  set eventId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEventId() => $_has(0);
  @$pb.TagNumber(1)
  void clearEventId() => $_clearField(1);

  /// 行の送信者の LiveKit identity(履歴の sender_id。消せるのは送った本人だけ)
  @$pb.TagNumber(2)
  $core.String get senderIdentity => $_getSZ(1);
  @$pb.TagNumber(2)
  set senderIdentity($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSenderIdentity() => $_has(1);
  @$pb.TagNumber(2)
  void clearSenderIdentity() => $_clearField(2);

  /// 行の種類。"text"(テキスト入力)か "media"(画像・動画)
  @$pb.TagNumber(3)
  $core.String get kind => $_getSZ(2);
  @$pb.TagNumber(3)
  set kind($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasKind() => $_has(2);
  @$pb.TagNumber(3)
  void clearKind() => $_clearField(3);

  /// text のとき、送信者のアプリが振った TextMessage の message_id(字幕の Caption の
  /// message_id と同じ)。受け手は、この message_id の字幕を「削除されたテキスト」にする。
  /// 分からなければ空
  @$pb.TagNumber(4)
  $core.String get messageId => $_getSZ(3);
  @$pb.TagNumber(4)
  set messageId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMessageId() => $_has(3);
  @$pb.TagNumber(4)
  void clearMessageId() => $_clearField(4);

  /// 消した時刻。ISO 8601(UTC、ミリ秒まで。例 2026-10-10T00:00:00.000Z)
  @$pb.TagNumber(5)
  $core.String get deletedAt => $_getSZ(4);
  @$pb.TagNumber(5)
  set deletedAt($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasDeletedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearDeletedAt() => $_clearField(5);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
