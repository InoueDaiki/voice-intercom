// This is a generated file - do not edit.
//
// Generated from voiceintercom/v1/deletion.proto.

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

@$core.Deprecated('Use deletionMessageDescriptor instead')
const DeletionMessage$json = {
  '1': 'DeletionMessage',
  '2': [
    {'1': 'event_id', '3': 1, '4': 1, '5': 9, '10': 'eventId'},
    {'1': 'sender_identity', '3': 2, '4': 1, '5': 9, '10': 'senderIdentity'},
    {'1': 'kind', '3': 3, '4': 1, '5': 9, '10': 'kind'},
    {'1': 'message_id', '3': 4, '4': 1, '5': 9, '10': 'messageId'},
    {'1': 'deleted_at', '3': 5, '4': 1, '5': 9, '10': 'deletedAt'},
  ],
};

/// Descriptor for `DeletionMessage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deletionMessageDescriptor = $convert.base64Decode(
    'Cg9EZWxldGlvbk1lc3NhZ2USGQoIZXZlbnRfaWQYASABKAlSB2V2ZW50SWQSJwoPc2VuZGVyX2'
    'lkZW50aXR5GAIgASgJUg5zZW5kZXJJZGVudGl0eRISCgRraW5kGAMgASgJUgRraW5kEh0KCm1l'
    'c3NhZ2VfaWQYBCABKAlSCW1lc3NhZ2VJZBIdCgpkZWxldGVkX2F0GAUgASgJUglkZWxldGVkQX'
    'Q=');
