//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class LiveKitTokenResponse {
  /// Returns a new [LiveKitTokenResponse] instance.
  LiveKitTokenResponse({
    required this.serverUrl,
    required this.participantToken,
  });

  /// 接続先の LiveKit の URL
  String serverUrl;

  /// LiveKit の参加用トークン
  String participantToken;

  @override
  bool operator ==(Object other) => identical(this, other) || other is LiveKitTokenResponse &&
    other.serverUrl == serverUrl &&
    other.participantToken == participantToken;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (serverUrl.hashCode) +
    (participantToken.hashCode);

  @override
  String toString() => 'LiveKitTokenResponse[serverUrl=$serverUrl, participantToken=$participantToken]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'server_url'] = this.serverUrl;
      json[r'participant_token'] = this.participantToken;
    return json;
  }

  /// Returns a new [LiveKitTokenResponse] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static LiveKitTokenResponse? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'server_url'), 'Required key "LiveKitTokenResponse[server_url]" is missing from JSON.');
        assert(json[r'server_url'] != null, 'Required key "LiveKitTokenResponse[server_url]" has a null value in JSON.');
        assert(json.containsKey(r'participant_token'), 'Required key "LiveKitTokenResponse[participant_token]" is missing from JSON.');
        assert(json[r'participant_token'] != null, 'Required key "LiveKitTokenResponse[participant_token]" has a null value in JSON.');
        return true;
      }());

      return LiveKitTokenResponse(
        serverUrl: mapValueOfType<String>(json, r'server_url')!,
        participantToken: mapValueOfType<String>(json, r'participant_token')!,
      );
    }
    return null;
  }

  static List<LiveKitTokenResponse> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <LiveKitTokenResponse>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = LiveKitTokenResponse.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, LiveKitTokenResponse> mapFromJson(dynamic json) {
    final map = <String, LiveKitTokenResponse>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = LiveKitTokenResponse.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of LiveKitTokenResponse-objects as value to a dart map
  static Map<String, List<LiveKitTokenResponse>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<LiveKitTokenResponse>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = LiveKitTokenResponse.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'server_url',
    'participant_token',
  };
}

