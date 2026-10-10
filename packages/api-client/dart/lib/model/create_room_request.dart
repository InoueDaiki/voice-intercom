//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class CreateRoomRequest {
  /// Returns a new [CreateRoomRequest] instance.
  CreateRoomRequest({
    required this.roomId,
    required this.name,
    this.memberIds = const [],
  });

  /// ルームの ID
  String roomId;

  /// ルームの表示名
  String name;

  /// メンバーの user_id(Cognito の sub)
  List<String> memberIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is CreateRoomRequest &&
    other.roomId == roomId &&
    other.name == name &&
    _deepEquality.equals(other.memberIds, memberIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (roomId.hashCode) +
    (name.hashCode) +
    (memberIds.hashCode);

  @override
  String toString() => 'CreateRoomRequest[roomId=$roomId, name=$name, memberIds=$memberIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'room_id'] = this.roomId;
      json[r'name'] = this.name;
      json[r'member_ids'] = this.memberIds;
    return json;
  }

  /// Returns a new [CreateRoomRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static CreateRoomRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'room_id'), 'Required key "CreateRoomRequest[room_id]" is missing from JSON.');
        assert(json[r'room_id'] != null, 'Required key "CreateRoomRequest[room_id]" has a null value in JSON.');
        assert(json.containsKey(r'name'), 'Required key "CreateRoomRequest[name]" is missing from JSON.');
        assert(json[r'name'] != null, 'Required key "CreateRoomRequest[name]" has a null value in JSON.');
        return true;
      }());

      return CreateRoomRequest(
        roomId: mapValueOfType<String>(json, r'room_id')!,
        name: mapValueOfType<String>(json, r'name')!,
        memberIds: json[r'member_ids'] is Iterable
            ? (json[r'member_ids'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<CreateRoomRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <CreateRoomRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = CreateRoomRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, CreateRoomRequest> mapFromJson(dynamic json) {
    final map = <String, CreateRoomRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = CreateRoomRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of CreateRoomRequest-objects as value to a dart map
  static Map<String, List<CreateRoomRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<CreateRoomRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = CreateRoomRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'room_id',
    'name',
  };
}

