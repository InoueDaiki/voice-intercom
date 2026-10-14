//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class UploadPartUrls {
  /// Returns a new [UploadPartUrls] instance.
  UploadPartUrls({
    this.parts = const [],
    required this.thumbnailUploadUrl,
    required this.expiresAt,
  });

  List<UploadPartUrl> parts;

  /// thumbnail が true で、サムネイルを上げるアップロードなら、その署名付き URL
  String? thumbnailUploadUrl;

  /// 署名付き URL の期限(ISO 8601、UTC)
  String expiresAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is UploadPartUrls &&
    _deepEquality.equals(other.parts, parts) &&
    other.thumbnailUploadUrl == thumbnailUploadUrl &&
    other.expiresAt == expiresAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (parts.hashCode) +
    (thumbnailUploadUrl == null ? 0 : thumbnailUploadUrl!.hashCode) +
    (expiresAt.hashCode);

  @override
  String toString() => 'UploadPartUrls[parts=$parts, thumbnailUploadUrl=$thumbnailUploadUrl, expiresAt=$expiresAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'parts'] = this.parts;
    if (this.thumbnailUploadUrl != null) {
      json[r'thumbnail_upload_url'] = this.thumbnailUploadUrl;
    } else {
      json[r'thumbnail_upload_url'] = null;
    }
      json[r'expires_at'] = this.expiresAt;
    return json;
  }

  /// Returns a new [UploadPartUrls] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static UploadPartUrls? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'parts'), 'Required key "UploadPartUrls[parts]" is missing from JSON.');
        assert(json[r'parts'] != null, 'Required key "UploadPartUrls[parts]" has a null value in JSON.');
        assert(json.containsKey(r'thumbnail_upload_url'), 'Required key "UploadPartUrls[thumbnail_upload_url]" is missing from JSON.');
        assert(json.containsKey(r'expires_at'), 'Required key "UploadPartUrls[expires_at]" is missing from JSON.');
        assert(json[r'expires_at'] != null, 'Required key "UploadPartUrls[expires_at]" has a null value in JSON.');
        return true;
      }());

      return UploadPartUrls(
        parts: UploadPartUrl.listFromJson(json[r'parts']),
        thumbnailUploadUrl: mapValueOfType<String>(json, r'thumbnail_upload_url'),
        expiresAt: mapValueOfType<String>(json, r'expires_at')!,
      );
    }
    return null;
  }

  static List<UploadPartUrls> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UploadPartUrls>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UploadPartUrls.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, UploadPartUrls> mapFromJson(dynamic json) {
    final map = <String, UploadPartUrls>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = UploadPartUrls.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of UploadPartUrls-objects as value to a dart map
  static Map<String, List<UploadPartUrls>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<UploadPartUrls>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = UploadPartUrls.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'parts',
    'thumbnail_upload_url',
    'expires_at',
  };
}

