// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/text.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// テキスト入力。アプリがデータチャネル(topic は "text"、reliable)で送る。
///
/// 送信者と言語はメッセージに持たせず、Agent が LiveKit の送信元の参加者(identity と属性
/// language)から取る。メッセージに持たせると、ほかの参加者になりすませるため。
/// Agent は原文と訳を Caption(message_id にこのメッセージの message_id を入れる)で配信し、
/// 読み上げ音声を言語別のトラック(translation-<言語>)に流す。
class TextMessage extends $pb.GeneratedMessage {
  factory TextMessage({
    $core.String? messageId,
    $core.String? text,
  }) {
    final result = TextMessage._();
    if (messageId != null) result.messageId = messageId;
    if (text != null) result.text = text;
    return result;
  }

  TextMessage._();

  factory TextMessage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TextMessage()..mergeFromBuffer(data, registry);
  factory TextMessage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TextMessage()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TextMessage',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'voiceintercom.v1'),
      createEmptyInstance: TextMessage.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'messageId')
    ..aOS(2, _omitFieldNames ? '' : 'text')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TextMessage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TextMessage copyWith(void Function(TextMessage) updates) =>
      super.copyWith((message) => updates(message as TextMessage))
          as TextMessage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TextMessage() / TextMessage.new instead')
  static TextMessage create() => TextMessage._();
  static $pb.GeneratedMessage $_createMessage() => TextMessage._();
  @$core.override
  TextMessage createEmptyInstance() => TextMessage._();
  @$core.pragma('dart2js:noInline')
  static TextMessage getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TextMessage>(
          TextMessage.$_createMessage);
  static TextMessage? _defaultInstance;

  /// 送信者のアプリが振る ID(UUID など)。配信される Caption の message_id に入る
  @$pb.TagNumber(1)
  $core.String get messageId => $_getSZ(0);
  @$pb.TagNumber(1)
  set messageId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMessageId() => $_has(0);
  @$pb.TagNumber(1)
  void clearMessageId() => $_clearField(1);

  /// 入力したテキスト
  @$pb.TagNumber(2)
  $core.String get text => $_getSZ(1);
  @$pb.TagNumber(2)
  set text($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasText() => $_has(1);
  @$pb.TagNumber(2)
  void clearText() => $_clearField(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
