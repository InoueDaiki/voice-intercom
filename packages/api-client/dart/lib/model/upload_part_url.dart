//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class UploadPartUrl {
  /// Returns a new [UploadPartUrl] instance.
  UploadPartUrl({
    required this.partNumber,
    required this.url,
  });

  int partNumber;

  /// パートを PUT する署名付き URL。Content-Type は要らない(付けても署名に入らない)。応答の ETag ヘッダーを complete に渡す
  String url;

  @override
  bool operator ==(Object other) => identical(this, other) || other is UploadPartUrl &&
    other.partNumber == partNumber &&
    other.url == url;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (partNumber.hashCode) +
    (url.hashCode);

  @override
  String toString() => 'UploadPartUrl[partNumber=$partNumber, url=$url]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'part_number'] = this.partNumber;
      json[r'url'] = this.url;
    return json;
  }

  /// Returns a new [UploadPartUrl] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static UploadPartUrl? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'part_number'), 'Required key "UploadPartUrl[part_number]" is missing from JSON.');
        assert(json[r'part_number'] != null, 'Required key "UploadPartUrl[part_number]" has a null value in JSON.');
        assert(json.containsKey(r'url'), 'Required key "UploadPartUrl[url]" is missing from JSON.');
        assert(json[r'url'] != null, 'Required key "UploadPartUrl[url]" has a null value in JSON.');
        return true;
      }());

      return UploadPartUrl(
        partNumber: mapValueOfType<int>(json, r'part_number')!,
        url: mapValueOfType<String>(json, r'url')!,
      );
    }
    return null;
  }

  static List<UploadPartUrl> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UploadPartUrl>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UploadPartUrl.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, UploadPartUrl> mapFromJson(dynamic json) {
    final map = <String, UploadPartUrl>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = UploadPartUrl.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of UploadPartUrl-objects as value to a dart map
  static Map<String, List<UploadPartUrl>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<UploadPartUrl>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = UploadPartUrl.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'part_number',
    'url',
  };
}

