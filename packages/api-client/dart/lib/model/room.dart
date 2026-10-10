//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class Room {
  /// Returns a new [Room] instance.
  Room({
    required this.roomId,
    required this.name,
    this.memberIds = const [],
    required this.createdAt,
    required this.updatedAt,
  });

  /// ルームの ID
  String roomId;

  /// ルームの表示名
  String name;

  /// メンバーの user_id(Cognito の sub)
  List<String> memberIds;

  /// ISO 8601(UTC)
  String createdAt;

  /// ISO 8601(UTC)
  String updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is Room &&
    other.roomId == roomId &&
    other.name == name &&
    _deepEquality.equals(other.memberIds, memberIds) &&
    other.createdAt == createdAt &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (roomId.hashCode) +
    (name.hashCode) +
    (memberIds.hashCode) +
    (createdAt.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'Room[roomId=$roomId, name=$name, memberIds=$memberIds, createdAt=$createdAt, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'room_id'] = this.roomId;
      json[r'name'] = this.name;
      json[r'member_ids'] = this.memberIds;
      json[r'created_at'] = this.createdAt;
      json[r'updated_at'] = this.updatedAt;
    return json;
  }

  /// Returns a new [Room] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static Room? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'room_id'), 'Required key "Room[room_id]" is missing from JSON.');
        assert(json[r'room_id'] != null, 'Required key "Room[room_id]" has a null value in JSON.');
        assert(json.containsKey(r'name'), 'Required key "Room[name]" is missing from JSON.');
        assert(json[r'name'] != null, 'Required key "Room[name]" has a null value in JSON.');
        assert(json.containsKey(r'member_ids'), 'Required key "Room[member_ids]" is missing from JSON.');
        assert(json[r'member_ids'] != null, 'Required key "Room[member_ids]" has a null value in JSON.');
        assert(json.containsKey(r'created_at'), 'Required key "Room[created_at]" is missing from JSON.');
        assert(json[r'created_at'] != null, 'Required key "Room[created_at]" has a null value in JSON.');
        assert(json.containsKey(r'updated_at'), 'Required key "Room[updated_at]" is missing from JSON.');
        assert(json[r'updated_at'] != null, 'Required key "Room[updated_at]" has a null value in JSON.');
        return true;
      }());

      return Room(
        roomId: mapValueOfType<String>(json, r'room_id')!,
        name: mapValueOfType<String>(json, r'name')!,
        memberIds: json[r'member_ids'] is Iterable
            ? (json[r'member_ids'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        createdAt: mapValueOfType<String>(json, r'created_at')!,
        updatedAt: mapValueOfType<String>(json, r'updated_at')!,
      );
    }
    return null;
  }

  static List<Room> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <Room>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = Room.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, Room> mapFromJson(dynamic json) {
    final map = <String, Room>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = Room.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of Room-objects as value to a dart map
  static Map<String, List<Room>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<Room>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = Room.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'room_id',
    'name',
    'member_ids',
    'created_at',
    'updated_at',
  };
}

