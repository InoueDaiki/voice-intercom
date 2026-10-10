//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SpeakingNotificationResult {
  /// Returns a new [SpeakingNotificationResult] instance.
  SpeakingNotificationResult({
    required this.sent,
    required this.skipped,
  });

  /// 送った人数
  int sent;

  /// 前回の通知から間隔がたっていないので、送らなかった人数
  int skipped;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SpeakingNotificationResult &&
    other.sent == sent &&
    other.skipped == skipped;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (sent.hashCode) +
    (skipped.hashCode);

  @override
  String toString() => 'SpeakingNotificationResult[sent=$sent, skipped=$skipped]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'sent'] = this.sent;
      json[r'skipped'] = this.skipped;
    return json;
  }

  /// Returns a new [SpeakingNotificationResult] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SpeakingNotificationResult? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'sent'), 'Required key "SpeakingNotificationResult[sent]" is missing from JSON.');
        assert(json[r'sent'] != null, 'Required key "SpeakingNotificationResult[sent]" has a null value in JSON.');
        assert(json.containsKey(r'skipped'), 'Required key "SpeakingNotificationResult[skipped]" is missing from JSON.');
        assert(json[r'skipped'] != null, 'Required key "SpeakingNotificationResult[skipped]" has a null value in JSON.');
        return true;
      }());

      return SpeakingNotificationResult(
        sent: mapValueOfType<int>(json, r'sent')!,
        skipped: mapValueOfType<int>(json, r'skipped')!,
      );
    }
    return null;
  }

  static List<SpeakingNotificationResult> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SpeakingNotificationResult>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SpeakingNotificationResult.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SpeakingNotificationResult> mapFromJson(dynamic json) {
    final map = <String, SpeakingNotificationResult>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SpeakingNotificationResult.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SpeakingNotificationResult-objects as value to a dart map
  static Map<String, List<SpeakingNotificationResult>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SpeakingNotificationResult>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SpeakingNotificationResult.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'sent',
    'skipped',
  };
}

