// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/caption.proto.

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

@$core.Deprecated('Use captionDescriptor instead')
const Caption$json = {
  '1': 'Caption',
  '2': [
    {'1': 'speaker_identity', '3': 1, '4': 1, '5': 9, '10': 'speakerIdentity'},
    {'1': 'segment_id', '3': 2, '4': 1, '5': 9, '10': 'segmentId'},
    {'1': 'language', '3': 3, '4': 1, '5': 9, '10': 'language'},
    {'1': 'translated', '3': 4, '4': 1, '5': 8, '10': 'translated'},
    {'1': 'text', '3': 5, '4': 1, '5': 9, '10': 'text'},
    {'1': 'is_final', '3': 6, '4': 1, '5': 8, '10': 'isFinal'},
    {'1': 'utterance_id', '3': 7, '4': 1, '5': 9, '10': 'utteranceId'},
    {'1': 'segment_index', '3': 8, '4': 1, '5': 13, '10': 'segmentIndex'},
    {'1': 'message_id', '3': 9, '4': 1, '5': 9, '10': 'messageId'},
  ],
};

/// Descriptor for `Caption`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List captionDescriptor = $convert.base64Decode(
    'CgdDYXB0aW9uEikKEHNwZWFrZXJfaWRlbnRpdHkYASABKAlSD3NwZWFrZXJJZGVudGl0eRIdCg'
    'pzZWdtZW50X2lkGAIgASgJUglzZWdtZW50SWQSGgoIbGFuZ3VhZ2UYAyABKAlSCGxhbmd1YWdl'
    'Eh4KCnRyYW5zbGF0ZWQYBCABKAhSCnRyYW5zbGF0ZWQSEgoEdGV4dBgFIAEoCVIEdGV4dBIZCg'
    'hpc19maW5hbBgGIAEoCFIHaXNGaW5hbBIhCgx1dHRlcmFuY2VfaWQYByABKAlSC3V0dGVyYW5j'
    'ZUlkEiMKDXNlZ21lbnRfaW5kZXgYCCABKA1SDHNlZ21lbnRJbmRleBIdCgptZXNzYWdlX2lkGA'
    'kgASgJUgltZXNzYWdlSWQ=');
