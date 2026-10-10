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

/// 字幕。Agent がデータチャネル(topic は "caption"、reliable)で配信する。
///
/// 字幕の区切りに segment_id を1つ振り、原文と各言語の翻訳で共有する。短い発話は発話全体が
/// 1つの区切りになる。長い発話は、Agent が息継ぎなどで途中を区切り、区切りごとに別の segment_id を
/// 振る(同じ発話の区切りは utterance_id を共有する)。
/// 受信側は (segment_id, language, translated) ごとに、断片(is_final が false)を順に連結して
/// 途中の字幕として表示し、確定(is_final が true)が届いたらその text で置き換える。
/// utterance_id を知らない受信側は、区切りを別々の字幕として表示すればよい。
class Caption extends $pb.GeneratedMessage {
  factory Caption({
    $core.String? speakerIdentity,
    $core.String? segmentId,
    $core.String? language,
    $core.bool? translated,
    $core.String? text,
    $core.bool? isFinal,
    $core.String? utteranceId,
    $core.int? segmentIndex,
  }) {
    final result = Caption._();
    if (speakerIdentity != null) result.speakerIdentity = speakerIdentity;
    if (segmentId != null) result.segmentId = segmentId;
    if (language != null) result.language = language;
    if (translated != null) result.translated = translated;
    if (text != null) result.text = text;
    if (isFinal != null) result.isFinal = isFinal;
    if (utteranceId != null) result.utteranceId = utteranceId;
    if (segmentIndex != null) result.segmentIndex = segmentIndex;
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
    ..aOS(7, _omitFieldNames ? '' : 'utteranceId')
    ..aI(8, _omitFieldNames ? '' : 'segmentIndex',
        fieldType: $pb.PbFieldType.OU3)
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

  /// 字幕の区切りの単位。原文と翻訳で同じ ID を使う
  @$pb.TagNumber(2)
  $core.String get segmentId => $_getSZ(1);
  @$pb.TagNumber(2)
  set segmentId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSegmentId() => $_has(1);
  @$pb.TagNumber(2)
  void clearSegmentId() => $_clearField(2);

  /// BCP 47 の言語コード。原文で話者の言語が分からないときは空
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

  /// is_final が false なら、追記する断片(連結時に空白を挟まない)。
  /// is_final が true なら、その言語の全文(それまでの断片を置き換える。空なら字幕を消す)
  @$pb.TagNumber(5)
  $core.String get text => $_getSZ(4);
  @$pb.TagNumber(5)
  set text($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasText() => $_has(4);
  @$pb.TagNumber(5)
  void clearText() => $_clearField(5);

  /// 確定なら true。同じ (segment_id, language, translated) では最後に1回だけ届く
  @$pb.TagNumber(6)
  $core.bool get isFinal => $_getBF(5);
  @$pb.TagNumber(6)
  set isFinal($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIsFinal() => $_has(5);
  @$pb.TagNumber(6)
  void clearIsFinal() => $_clearField(6);

  /// 発話(PTT を押してから離すまで)の単位。同じ発話の区切りで共有する。
  /// 空なら、その segment_id が1つの発話にあたる(この項目を足す前の Agent)
  @$pb.TagNumber(7)
  $core.String get utteranceId => $_getSZ(6);
  @$pb.TagNumber(7)
  set utteranceId($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasUtteranceId() => $_has(6);
  @$pb.TagNumber(7)
  void clearUtteranceId() => $_clearField(7);

  /// 発話の中での区切りの順番(0 から)。訳の確定は区切りの順に届くとは限らないので、並べるときに使う
  @$pb.TagNumber(8)
  $core.int get segmentIndex => $_getIZ(7);
  @$pb.TagNumber(8)
  set segmentIndex($core.int value) => $_setUnsignedInt32(7, value);
  @$pb.TagNumber(8)
  $core.bool hasSegmentIndex() => $_has(7);
  @$pb.TagNumber(8)
  void clearSegmentIndex() => $_clearField(8);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
