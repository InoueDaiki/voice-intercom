//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class TextNotificationRequest {
  /// Returns a new [TextNotificationRequest] instance.
  TextNotificationRequest({
    required this.senderId,
    this.presentIds = const [],
    required this.text,
  });

  /// 送信者の user_id(sub)
  String senderId;

  /// 今ルームに入っている人の user_id(sub)。この人たちには送らない
  List<String> presentIds;

  /// 送られたテキスト(本文には先頭だけを入れる)
  String text;

  @override
  bool operator ==(Object other) => identical(this, other) || other is TextNotificationRequest &&
    other.senderId == senderId &&
    _deepEquality.equals(other.presentIds, presentIds) &&
    other.text == text;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (senderId.hashCode) +
    (presentIds.hashCode) +
    (text.hashCode);

  @override
  String toString() => 'TextNotificationRequest[senderId=$senderId, presentIds=$presentIds, text=$text]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'sender_id'] = this.senderId;
      json[r'present_ids'] = this.presentIds;
      json[r'text'] = this.text;
    return json;
  }

  /// Returns a new [TextNotificationRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static TextNotificationRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'sender_id'), 'Required key "TextNotificationRequest[sender_id]" is missing from JSON.');
        assert(json[r'sender_id'] != null, 'Required key "TextNotificationRequest[sender_id]" has a null value in JSON.');
        assert(json.containsKey(r'text'), 'Required key "TextNotificationRequest[text]" is missing from JSON.');
        assert(json[r'text'] != null, 'Required key "TextNotificationRequest[text]" has a null value in JSON.');
        return true;
      }());

      return TextNotificationRequest(
        senderId: mapValueOfType<String>(json, r'sender_id')!,
        presentIds: json[r'present_ids'] is Iterable
            ? (json[r'present_ids'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        text: mapValueOfType<String>(json, r'text')!,
      );
    }
    return null;
  }

  static List<TextNotificationRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TextNotificationRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TextNotificationRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, TextNotificationRequest> mapFromJson(dynamic json) {
    final map = <String, TextNotificationRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = TextNotificationRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of TextNotificationRequest-objects as value to a dart map
  static Map<String, List<TextNotificationRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<TextNotificationRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = TextNotificationRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'sender_id',
    'text',
  };
}

