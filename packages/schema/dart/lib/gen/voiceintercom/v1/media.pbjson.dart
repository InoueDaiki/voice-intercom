// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/media.proto.

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

@$core.Deprecated('Use mediaMessageDescriptor instead')
const MediaMessage$json = {
  '1': 'MediaMessage',
  '2': [
    {'1': 'event_id', '3': 1, '4': 1, '5': 9, '10': 'eventId'},
    {'1': 'sender_identity', '3': 2, '4': 1, '5': 9, '10': 'senderIdentity'},
    {'1': 'occurred_at', '3': 3, '4': 1, '5': 9, '10': 'occurredAt'},
    {'1': 'media_id', '3': 4, '4': 1, '5': 9, '10': 'mediaId'},
    {'1': 'content_type', '3': 5, '4': 1, '5': 9, '10': 'contentType'},
    {'1': 'url', '3': 6, '4': 1, '5': 9, '10': 'url'},
    {'1': 'thumbnail_url', '3': 7, '4': 1, '5': 9, '10': 'thumbnailUrl'},
    {'1': 'size_bytes', '3': 8, '4': 1, '5': 4, '10': 'sizeBytes'},
    {'1': 'text', '3': 9, '4': 1, '5': 9, '10': 'text'},
    {'1': 'text_truncated', '3': 10, '4': 1, '5': 8, '10': 'textTruncated'},
    {'1': 'language', '3': 11, '4': 1, '5': 9, '10': 'language'},
  ],
};

/// Descriptor for `MediaMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List mediaMessageDescriptor = $convert.base64Decode(
    'CgxNZWRpYU1lc3NhZ2USGQoIZXZlbnRfaWQYASABKAlSB2V2ZW50SWQSJwoPc2VuZGVyX2lkZW'
    '50aXR5GAIgASgJUg5zZW5kZXJJZGVudGl0eRIfCgtvY2N1cnJlZF9hdBgDIAEoCVIKb2NjdXJy'
    'ZWRBdBIZCghtZWRpYV9pZBgEIAEoCVIHbWVkaWFJZBIhCgxjb250ZW50X3R5cGUYBSABKAlSC2'
    'NvbnRlbnRUeXBlEhAKA3VybBgGIAEoCVIDdXJsEiMKDXRodW1ibmFpbF91cmwYByABKAlSDHRo'
    'dW1ibmFpbFVybBIdCgpzaXplX2J5dGVzGAggASgEUglzaXplQnl0ZXMSEgoEdGV4dBgJIAEoCV'
    'IEdGV4dBIlCg50ZXh0X3RydW5jYXRlZBgKIAEoCFINdGV4dFRydW5jYXRlZBIaCghsYW5ndWFn'
    'ZRgLIAEoCVIIbGFuZ3VhZ2U=');
