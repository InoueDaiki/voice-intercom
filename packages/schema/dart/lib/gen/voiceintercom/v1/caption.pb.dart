// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/caption.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// 字幕の断片。Agent がデータチャネルで配信する。
/// 生成パイプラインを通すための最初の定義で、実装時に見直す。
class Caption extends $pb.GeneratedMessage {
  factory Caption({
    $core.String? speakerIdentity,
    $core.String? segmentId,
    $core.String? language,
    $core.bool? translated,
    $core.String? text,
    $core.bool? isFinal,
  }) {
    final result = Caption._();
    if (speakerIdentity != null) result.speakerIdentity = speakerIdentity;
    if (segmentId != null) result.segmentId = segmentId;
    if (language != null) result.language = language;
    if (translated != null) result.translated = translated;
    if (text != null) result.text = text;
    if (isFinal != null) result.isFinal = isFinal;
    return result;
  }

  Caption._();

  factory Caption.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Caption()..mergeFromBuffer(data, registry);
  factory Caption.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Caption()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Caption',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'voiceintercom.v1'),
      createEmptyInstance: Caption.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'speakerIdentity')
    ..aOS(2, _omitFieldNames ? '' : 'segmentId')
    ..aOS(3, _omitFieldNames ? '' : 'language')
    ..aOB(4, _omitFieldNames ? '' : 'translated')
    ..aOS(5, _omitFieldNames ? '' : 'text')
    ..aOB(6, _omitFieldNames ? '' : 'isFinal')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Caption clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Caption copyWith(void Function(Caption) updates) =>
      super.copyWith((message) => updates(message as Caption)) as Caption;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Caption() / Caption.new instead')
  static Caption create() => Caption._();
  static $pb.GeneratedMessage $_createMessage() => Caption._();
  @$core.override
  Caption createEmptyInstance() => Caption._();
  @$core.pragma('dart2js:noInline')
  static Caption getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Caption>(Caption.$_createMessage);
  static Caption? _defaultInstance;

  /// 話者の LiveKit identity
  @$pb.TagNumber(1)
  $core.String get speakerIdentity => $_getSZ(0);
  @$pb.TagNumber(1)
  set speakerIdentity($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSpeakerIdentity() => $_has(0);
  @$pb.TagNumber(1)
  void clearSpeakerIdentity() => $_clearField(1);

  /// 発話の単位。同じ ID の断片を順に連結する
  @$pb.TagNumber(2)
  $core.String get segmentId => $_getSZ(1);
  @$pb.TagNumber(2)
  set segmentId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSegmentId() => $_has(1);
  @$pb.TagNumber(2)
  void clearSegmentId() => $_clearField(2);

  /// BCP 47 の言語コード
  @$pb.TagNumber(3)
  $core.String get language => $_getSZ(2);
  @$pb.TagNumber(3)
  set language($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLanguage() => $_has(2);
  @$pb.TagNumber(3)
  void clearLanguage() => $_clearField(3);

  /// false なら原文、true なら翻訳
  @$pb.TagNumber(4)
  $core.bool get translated => $_getBF(3);
  @$pb.TagNumber(4)
  set translated($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTranslated() => $_has(3);
  @$pb.TagNumber(4)
  void clearTranslated() => $_clearField(4);

  /// 追記する断片(連結時に空白を挟まない)
  @$pb.TagNumber(5)
  $core.String get text => $_getSZ(4);
  @$pb.TagNumber(5)
  set text($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasText() => $_has(4);
  @$pb.TagNumber(5)
  void clearText() => $_clearField(5);

  /// この発話の最後の断片なら true
  @$pb.TagNumber(6)
  $core.bool get isFinal => $_getBF(5);
  @$pb.TagNumber(6)
  set isFinal($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIsFinal() => $_has(5);
  @$pb.TagNumber(6)
  void clearIsFinal() => $_clearField(6);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
