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

class TextStatus_State extends $pb.ProtobufEnum {
  static const TextStatus_State STATE_UNSPECIFIED =
      TextStatus_State._(0, _omitEnumNames ? '' : 'STATE_UNSPECIFIED');

  /// 受け付けた。原文の字幕より先に送る
  static const TextStatus_State STATE_ACCEPTED =
      TextStatus_State._(1, _omitEnumNames ? '' : 'STATE_ACCEPTED');

  /// 断った(reason に理由)。字幕も読み上げも出さない
  static const TextStatus_State STATE_REJECTED =
      TextStatus_State._(2, _omitEnumNames ? '' : 'STATE_REJECTED');

  /// 翻訳か読み上げの一部(または全部)に失敗した。失敗した言語は untranslated_languages と
  /// unspoken_languages に入る。ほかの言語の字幕と読み上げは出ている
  static const TextStatus_State STATE_FAILED =
      TextStatus_State._(3, _omitEnumNames ? '' : 'STATE_FAILED');

  /// 翻訳と読み上げを、すべて終えた
  static const TextStatus_State STATE_COMPLETED =
      TextStatus_State._(4, _omitEnumNames ? '' : 'STATE_COMPLETED');

  static const $core.List<TextStatus_State> values = <TextStatus_State>[
    STATE_UNSPECIFIED,
    STATE_ACCEPTED,
    STATE_REJECTED,
    STATE_FAILED,
    STATE_COMPLETED,
  ];

  static final $core.List<TextStatus_State?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static TextStatus_State? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const TextStatus_State._(super.value, super.name);
}

class TextStatus_Reason extends $pb.ProtobufEnum {
  static const TextStatus_Reason REASON_UNSPECIFIED =
      TextStatus_Reason._(0, _omitEnumNames ? '' : 'REASON_UNSPECIFIED');

  /// 前後の空白を除くと空
  static const TextStatus_Reason REASON_EMPTY =
      TextStatus_Reason._(1, _omitEnumNames ? '' : 'REASON_EMPTY');

  /// 長すぎる(max_chars を超えた)
  static const TextStatus_Reason REASON_TOO_LONG =
      TextStatus_Reason._(2, _omitEnumNames ? '' : 'REASON_TOO_LONG');

  static const $core.List<TextStatus_Reason> values = <TextStatus_Reason>[
    REASON_UNSPECIFIED,
    REASON_EMPTY,
    REASON_TOO_LONG,
  ];

  static final $core.List<TextStatus_Reason?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static TextStatus_Reason? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const TextStatus_Reason._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
