//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class UpdateRoomRequest {
  /// Returns a new [UpdateRoomRequest] instance.
  UpdateRoomRequest({
    this.name,
    this.memberIds = const [],
  });

  /// ルームの表示名
  String? name;

  /// メンバーの user_id(Cognito の sub)
  List<String>? memberIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is UpdateRoomRequest &&
    other.name == name &&
    _deepEquality.equals(other.memberIds, memberIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name == null ? 0 : name!.hashCode) +
    (memberIds == null ? 0 : memberIds!.hashCode);

  @override
  String toString() => 'UpdateRoomRequest[name=$name, memberIds=$memberIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.name != null) {
      json[r'name'] = this.name;
    } else {
      json[r'name'] = null;
    }
    if (this.memberIds != null) {
      json[r'member_ids'] = this.memberIds;
    } else {
      json[r'member_ids'] = null;
    }
    return json;
  }

  /// Returns a new [UpdateRoomRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static UpdateRoomRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return UpdateRoomRequest(
        name: mapValueOfType<String>(json, r'name'),
        memberIds: json[r'member_ids'] is Iterable
            ? (json[r'member_ids'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<UpdateRoomRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UpdateRoomRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UpdateRoomRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, UpdateRoomRequest> mapFromJson(dynamic json) {
    final map = <String, UpdateRoomRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = UpdateRoomRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of UpdateRoomRequest-objects as value to a dart map
  static Map<String, List<UpdateRoomRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<UpdateRoomRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = UpdateRoomRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

