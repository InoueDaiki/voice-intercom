//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MultipartUpload {
  /// Returns a new [MultipartUpload] instance.
  MultipartUpload({
    required this.partSize,
    required this.partCount,
  });

  /// パートのバイト数。最後のパートだけは残り(これ以下)。パート n はファイルの (n-1)*part_size バイト目から
  int partSize;

  /// パートの数。番号は 1 から part_count
  int partCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MultipartUpload &&
    other.partSize == partSize &&
    other.partCount == partCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (partSize.hashCode) +
    (partCount.hashCode);

  @override
  String toString() => 'MultipartUpload[partSize=$partSize, partCount=$partCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'part_size'] = this.partSize;
      json[r'part_count'] = this.partCount;
    return json;
  }

  /// Returns a new [MultipartUpload] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MultipartUpload? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'part_size'), 'Required key "MultipartUpload[part_size]" is missing from JSON.');
        assert(json[r'part_size'] != null, 'Required key "MultipartUpload[part_size]" has a null value in JSON.');
        assert(json.containsKey(r'part_count'), 'Required key "MultipartUpload[part_count]" is missing from JSON.');
        assert(json[r'part_count'] != null, 'Required key "MultipartUpload[part_count]" has a null value in JSON.');
        return true;
      }());

      return MultipartUpload(
        partSize: mapValueOfType<int>(json, r'part_size')!,
        partCount: mapValueOfType<int>(json, r'part_count')!,
      );
    }
    return null;
  }

  static List<MultipartUpload> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MultipartUpload>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MultipartUpload.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MultipartUpload> mapFromJson(dynamic json) {
    final map = <String, MultipartUpload>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MultipartUpload.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MultipartUpload-objects as value to a dart map
  static Map<String, List<MultipartUpload>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MultipartUpload>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MultipartUpload.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'part_size',
    'part_count',
  };
}

