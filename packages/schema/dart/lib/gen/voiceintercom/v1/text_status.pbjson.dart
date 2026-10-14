// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/text_status.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports
// ignore_for_file: unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

@$core.Deprecated('Use textStatusDescriptor instead')
const TextStatus$json = {
  '1': 'TextStatus',
  '2': [
    {'1': 'message_id', '3': 1, '4': 1, '5': 9, '10': 'messageId'},
    {
      '1': 'state',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.voiceintercom.v1.TextStatus.State',
      '10': 'state'
    },
    {
      '1': 'reason',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.voiceintercom.v1.TextStatus.Reason',
      '10': 'reason'
    },
    {'1': 'max_chars', '3': 4, '4': 1, '5': 13, '10': 'maxChars'},
    {
      '1': 'untranslated_languages',
      '3': 5,
      '4': 3,
      '5': 9,
      '10': 'untranslatedLanguages'
    },
    {
      '1': 'unspoken_languages',
      '3': 6,
      '4': 3,
      '5': 9,
      '10': 'unspokenLanguages'
    },
  ],
  '4': [TextStatus_State$json, TextStatus_Reason$json],
};

@$core.Deprecated('Use textStatusDescriptor instead')
const TextStatus_State$json = {
  '1': 'State',
  '2': [
    {'1': 'STATE_UNSPECIFIED', '2': 0},
    {'1': 'STATE_ACCEPTED', '2': 1},
    {'1': 'STATE_REJECTED', '2': 2},
    {'1': 'STATE_FAILED', '2': 3},
    {'1': 'STATE_COMPLETED', '2': 4},
  ],
};

@$core.Deprecated('Use textStatusDescriptor instead')
const TextStatus_Reason$json = {
  '1': 'Reason',
  '2': [
    {'1': 'REASON_UNSPECIFIED', '2': 0},
    {'1': 'REASON_EMPTY', '2': 1},
    {'1': 'REASON_TOO_LONG', '2': 2},
  ],
};

/// Descriptor for `TextStatus`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List textStatusDescriptor = $convert.base64Decode(
    'CgpUZXh0U3RhdHVzEh0KCm1lc3NhZ2VfaWQYASABKAlSCW1lc3NhZ2VJZBI4CgVzdGF0ZRgCIA'
    'EoDjIiLnZvaWNlaW50ZXJjb20udjEuVGV4dFN0YXR1cy5TdGF0ZVIFc3RhdGUSOwoGcmVhc29u'
    'GAMgASgOMiMudm9pY2VpbnRlcmNvbS52MS5UZXh0U3RhdHVzLlJlYXNvblIGcmVhc29uEhsKCW'
    '1heF9jaGFycxgEIAEoDVIIbWF4Q2hhcnMSNQoWdW50cmFuc2xhdGVkX2xhbmd1YWdlcxgFIAMo'
    'CVIVdW50cmFuc2xhdGVkTGFuZ3VhZ2VzEi0KEnVuc3Bva2VuX2xhbmd1YWdlcxgGIAMoCVIRdW'
    '5zcG9rZW5MYW5ndWFnZXMibQoFU3RhdGUSFQoRU1RBVEVfVU5TUEVDSUZJRUQQABISCg5TVEFU'
    'RV9BQ0NFUFRFRBABEhIKDlNUQVRFX1JFSkVDVEVEEAISEAoMU1RBVEVfRkFJTEVEEAMSEwoPU1'
    'RBVEVfQ09NUExFVEVEEAQiRwoGUmVhc29uEhYKElJFQVNPTl9VTlNQRUNJRklFRBAAEhAKDFJF'
    'QVNPTl9FTVBUWRABEhMKD1JFQVNPTl9UT09fTE9ORxAC');
