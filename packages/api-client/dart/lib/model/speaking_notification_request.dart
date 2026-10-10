//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SpeakingNotificationRequest {
  /// Returns a new [SpeakingNotificationRequest] instance.
  SpeakingNotificationRequest({
    required this.speakerId,
    this.presentIds = const [],
  });

  /// 話者の user_id(sub)
  String speakerId;

  /// 今ルームに入っている人の user_id(sub)。この人たちには送らない
  List<String> presentIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SpeakingNotificationRequest &&
    other.speakerId == speakerId &&
    _deepEquality.equals(other.presentIds, presentIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (speakerId.hashCode) +
    (presentIds.hashCode);

  @override
  String toString() => 'SpeakingNotificationRequest[speakerId=$speakerId, presentIds=$presentIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'speaker_id'] = this.speakerId;
      json[r'present_ids'] = this.presentIds;
    return json;
  }

  /// Returns a new [SpeakingNotificationRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SpeakingNotificationRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'speaker_id'), 'Required key "SpeakingNotificationRequest[speaker_id]" is missing from JSON.');
        assert(json[r'speaker_id'] != null, 'Required key "SpeakingNotificationRequest[speaker_id]" has a null value in JSON.');
        return true;
      }());

      return SpeakingNotificationRequest(
        speakerId: mapValueOfType<String>(json, r'speaker_id')!,
        presentIds: json[r'present_ids'] is Iterable
            ? (json[r'present_ids'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<SpeakingNotificationRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SpeakingNotificationRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SpeakingNotificationRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SpeakingNotificationRequest> mapFromJson(dynamic json) {
    final map = <String, SpeakingNotificationRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SpeakingNotificationRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SpeakingNotificationRequest-objects as value to a dart map
  static Map<String, List<SpeakingNotificationRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SpeakingNotificationRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SpeakingNotificationRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'speaker_id',
  };
}

