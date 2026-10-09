//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LiveKitTokenRequest {
  /// Returns a new [LiveKitTokenRequest] instance.
  LiveKitTokenRequest({
    required this.roomName,
  });

  /// 入るルームの名前
  String roomName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LiveKitTokenRequest &&
    other.roomName == roomName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (roomName.hashCode);

  @override
  String toString() => 'LiveKitTokenRequest[roomName=$roomName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'room_name'] = this.roomName;
    return json;
  }

  /// Returns a new [LiveKitTokenRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LiveKitTokenRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'room_name'), 'Required key "LiveKitTokenRequest[room_name]" is missing from JSON.');
        assert(json[r'room_name'] != null, 'Required key "LiveKitTokenRequest[room_name]" has a null value in JSON.');
        return true;
      }());

      return LiveKitTokenRequest(
        roomName: mapValueOfType<String>(json, r'room_name')!,
      );
    }
    return null;
  }

  static List<LiveKitTokenRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LiveKitTokenRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LiveKitTokenRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LiveKitTokenRequest> mapFromJson(dynamic json) {
    final map = <String, LiveKitTokenRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LiveKitTokenRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LiveKitTokenRequest-objects as value to a dart map
  static Map<String, List<LiveKitTokenRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LiveKitTokenRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LiveKitTokenRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'room_name',
  };
}

