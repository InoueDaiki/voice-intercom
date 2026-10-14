//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class MediaUpload {
  /// Returns a new [MediaUpload] instance.
  MediaUpload({
    required this.mediaId,
    required this.uploadUrl,
    required this.thumbnailUploadUrl,
    required this.expiresAt,
    this.multipart,
  });

  String mediaId;

  /// 本体を1回で PUT する署名付き URL。Content-Type ヘッダーを content_type と同じにする。マルチパート(multipart がある)なら null
  String? uploadUrl;

  /// サムネイルを PUT する署名付き URL(Content-Type は image/jpeg)。has_thumbnail が false なら null
  String? thumbnailUploadUrl;

  /// 署名付き URL の期限(ISO 8601、UTC)
  String expiresAt;

  /// 本体をマルチパートで上げるなら、その分け方。パートの署名付き URL は POST .../media/{media_id}/parts で取る
  MultipartUpload? multipart;

  @override
  bool operator ==(Object other) => identical(this, other) || other is MediaUpload &&
    other.mediaId == mediaId &&
    other.uploadUrl == uploadUrl &&
    other.thumbnailUploadUrl == thumbnailUploadUrl &&
    other.expiresAt == expiresAt &&
    other.multipart == multipart;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (mediaId.hashCode) +
    (uploadUrl == null ? 0 : uploadUrl!.hashCode) +
    (thumbnailUploadUrl == null ? 0 : thumbnailUploadUrl!.hashCode) +
    (expiresAt.hashCode) +
    (multipart == null ? 0 : multipart!.hashCode);

  @override
  String toString() => 'MediaUpload[mediaId=$mediaId, uploadUrl=$uploadUrl, thumbnailUploadUrl=$thumbnailUploadUrl, expiresAt=$expiresAt, multipart=$multipart]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'media_id'] = this.mediaId;
    if (this.uploadUrl != null) {
      json[r'upload_url'] = this.uploadUrl;
    } else {
      json[r'upload_url'] = null;
    }
    if (this.thumbnailUploadUrl != null) {
      json[r'thumbnail_upload_url'] = this.thumbnailUploadUrl;
    } else {
      json[r'thumbnail_upload_url'] = null;
    }
      json[r'expires_at'] = this.expiresAt;
    if (this.multipart != null) {
      json[r'multipart'] = this.multipart;
    } else {
      json[r'multipart'] = null;
    }
    return json;
  }

  /// Returns a new [MediaUpload] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static MediaUpload? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'media_id'), 'Required key "MediaUpload[media_id]" is missing from JSON.');
        assert(json[r'media_id'] != null, 'Required key "MediaUpload[media_id]" has a null value in JSON.');
        assert(json.containsKey(r'upload_url'), 'Required key "MediaUpload[upload_url]" is missing from JSON.');
        assert(json.containsKey(r'thumbnail_upload_url'), 'Required key "MediaUpload[thumbnail_upload_url]" is missing from JSON.');
        assert(json.containsKey(r'expires_at'), 'Required key "MediaUpload[expires_at]" is missing from JSON.');
        assert(json[r'expires_at'] != null, 'Required key "MediaUpload[expires_at]" has a null value in JSON.');
        return true;
      }());

      return MediaUpload(
        mediaId: mapValueOfType<String>(json, r'media_id')!,
        uploadUrl: mapValueOfType<String>(json, r'upload_url'),
        thumbnailUploadUrl: mapValueOfType<String>(json, r'thumbnail_upload_url'),
        expiresAt: mapValueOfType<String>(json, r'expires_at')!,
        multipart: MultipartUpload.fromJson(json[r'multipart']),
      );
    }
    return null;
  }

  static List<MediaUpload> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <MediaUpload>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = MediaUpload.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, MediaUpload> mapFromJson(dynamic json) {
    final map = <String, MediaUpload>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = MediaUpload.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of MediaUpload-objects as value to a dart map
  static Map<String, List<MediaUpload>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<MediaUpload>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = MediaUpload.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'media_id',
    'upload_url',
    'thumbnail_upload_url',
    'expires_at',
  };
}

