// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/text_status.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'text_status.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'text_status.pbenum.dart';

/// テキスト入力(text.proto の TextMessage)の受け付けと結果。Agent が送信者だけに宛てて
/// (destination_identities)、データチャネル(topic "text_status"、reliable)で送る。
///
/// 1通について、まず ACCEPTED か REJECTED を1回送る。ACCEPTED なら、翻訳と読み上げを終えたときに
/// COMPLETED か FAILED を1回送る。同じ message_id で送り直されたら、そのときの状態を送り直す
/// (処理中なら ACCEPTED)。受け手は、送信元が Agent の参加者のものだけを読む(字幕と同じ)。
/// この取り決めを知らない Agent は何も送らないので、受け手は字幕(Caption の message_id)でも
/// 届いたことを確かめる。
class TextStatus extends $pb.GeneratedMessage {
  factory TextStatus({
    $core.String? messageId,
    TextStatus_State? state,
    TextStatus_Reason? reason,
    $core.int? maxChars,
    $core.Iterable<$core.String>? untranslatedLanguages,
    $core.Iterable<$core.String>? unspokenLanguages,
  }) {
    final result = TextStatus._();
    if (messageId != null) result.messageId = messageId;
    if (state != null) result.state = state;
    if (reason != null) result.reason = reason;
    if (maxChars != null) result.maxChars = maxChars;
    if (untranslatedLanguages != null)
      result.untranslatedLanguages.addAll(untranslatedLanguages);
    if (unspokenLanguages != null)
      result.unspokenLanguages.addAll(unspokenLanguages);
    return result;
  }

  TextStatus._();

  factory TextStatus.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TextStatus()..mergeFromBuffer(data, registry);
  factory TextStatus.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TextStatus()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TextStatus',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'voiceintercom.v1'),
      createEmptyInstance: TextStatus.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'messageId')
    ..aE<TextStatus_State>(2, _omitFieldNames ? '' : 'state',
        enumValues: TextStatus_State.values)
    ..aE<TextStatus_Reason>(3, _omitFieldNames ? '' : 'reason',
        enumValues: TextStatus_Reason.values)
    ..aI(4, _omitFieldNames ? '' : 'maxChars', fieldType: $pb.PbFieldType.OU3)
    ..pPS(5, _omitFieldNames ? '' : 'untranslatedLanguages')
    ..pPS(6, _omitFieldNames ? '' : 'unspokenLanguages')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TextStatus clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TextStatus copyWith(void Function(TextStatus) updates) =>
      super.copyWith((message) => updates(message as TextStatus)) as TextStatus;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TextStatus() / TextStatus.new instead')
  static TextStatus create() => TextStatus._();
  static $pb.GeneratedMessage $_createMessage() => TextStatus._();
  @$core.override
  TextStatus createEmptyInstance() => TextStatus._();
  @$core.pragma('dart2js:noInline')
  static TextStatus getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TextStatus>(TextStatus.$_createMessage);
  static TextStatus? _defaultInstance;

  /// 送信者のアプリが振った TextMessage の message_id
  @$pb.TagNumber(1)
  $core.String get messageId => $_getSZ(0);
  @$pb.TagNumber(1)
  set messageId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMessageId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessageId() => $_clearField(1);

  @$pb.TagNumber(2)
  TextStatus_State get state => $_getN(1);
  @$pb.TagNumber(2)
  set state(TextStatus_State value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasState() => $_has(1);
  @$pb.TagNumber(2)
  void clearState() => $_clearField(2);

  /// REJECTED の理由。ほかの状態では REASON_UNSPECIFIED
  @$pb.TagNumber(3)
  TextStatus_Reason get reason => $_getN(2);
  @$pb.TagNumber(3)
  set reason(TextStatus_Reason value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasReason() => $_has(2);
  @$pb.TagNumber(3)
  void clearReason() => $_clearField(3);

  /// REJECTED で REASON_TOO_LONG のとき、受け付ける最大の文字数
  @$pb.TagNumber(4)
  $core.int get maxChars => $_getIZ(3);
  @$pb.TagNumber(4)
  set maxChars($core.int value) => $_setUnsignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasMaxChars() => $_has(3);
  @$pb.TagNumber(4)
  void clearMaxChars() => $_clearField(4);

  /// FAILED のとき、訳せなかった言語(BCP 47)
  @$pb.TagNumber(5)
  $pb.PbList<$core.String> get untranslatedLanguages => $_getList(4);

  /// FAILED のとき、読み上げに失敗した言語(原文の読み上げなら送信者の言語)
  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get unspokenLanguages => $_getList(5);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
