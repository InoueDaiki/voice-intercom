//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class CompletedPart {
  /// Returns a new [CompletedPart] instance.
  CompletedPart({
    required this.partNumber,
    required this.etag,
  });

  /// パートの番号(1 から)
  ///
  /// Minimum value: 1
  /// Maximum value: 10000
  int partNumber;

  /// パートの PUT の応答の ETag ヘッダー(そのまま)
  String etag;

  @override
  bool operator ==(Object other) => identical(this, other) || other is CompletedPart &&
    other.partNumber == partNumber &&
    other.etag == etag;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (partNumber.hashCode) +
    (etag.hashCode);

  @override
  String toString() => 'CompletedPart[partNumber=$partNumber, etag=$etag]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'part_number'] = this.partNumber;
      json[r'etag'] = this.etag;
    return json;
  }

  /// Returns a new [CompletedPart] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static CompletedPart? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'part_number'), 'Required key "CompletedPart[part_number]" is missing from JSON.');
        assert(json[r'part_number'] != null, 'Required key "CompletedPart[part_number]" has a null value in JSON.');
        assert(json.containsKey(r'etag'), 'Required key "CompletedPart[etag]" is missing from JSON.');
        assert(json[r'etag'] != null, 'Required key "CompletedPart[etag]" has a null value in JSON.');
        return true;
      }());

      return CompletedPart(
        partNumber: mapValueOfType<int>(json, r'part_number')!,
        etag: mapValueOfType<String>(json, r'etag')!,
      );
    }
    return null;
  }

  static List<CompletedPart> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <CompletedPart>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = CompletedPart.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, CompletedPart> mapFromJson(dynamic json) {
    final map = <String, CompletedPart>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = CompletedPart.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of CompletedPart-objects as value to a dart map
  static Map<String, List<CompletedPart>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<CompletedPart>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = CompletedPart.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'part_number',
    'etag',
  };
}

