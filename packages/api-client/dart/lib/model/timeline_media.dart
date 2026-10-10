//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class TimelineMedia {
  /// Returns a new [TimelineMedia] instance.
  TimelineMedia({
    required this.mediaId,
    required this.contentType,
    required this.url,
    required this.thumbnailUrl,
    required this.sizeBytes,
  });

  String mediaId;

  TimelineMediaContentTypeEnum contentType;

  /// 表示・再生の URL(CloudFront)
  String url;

  /// サムネイルの URL。なければ null
  String? thumbnailUrl;

  int sizeBytes;

  @override
  bool operator ==(Object other) => identical(this, other) || other is TimelineMedia &&
    other.mediaId == mediaId &&
    other.contentType == contentType &&
    other.url == url &&
    other.thumbnailUrl == thumbnailUrl &&
    other.sizeBytes == sizeBytes;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (mediaId.hashCode) +
    (contentType.hashCode) +
    (url.hashCode) +
    (thumbnailUrl == null ? 0 : thumbnailUrl!.hashCode) +
    (sizeBytes.hashCode);

  @override
  String toString() => 'TimelineMedia[mediaId=$mediaId, contentType=$contentType, url=$url, thumbnailUrl=$thumbnailUrl, sizeBytes=$sizeBytes]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'media_id'] = this.mediaId;
      json[r'content_type'] = this.contentType;
      json[r'url'] = this.url;
    if (this.thumbnailUrl != null) {
      json[r'thumbnail_url'] = this.thumbnailUrl;
    } else {
      json[r'thumbnail_url'] = null;
    }
      json[r'size_bytes'] = this.sizeBytes;
    return json;
  }

  /// Returns a new [TimelineMedia] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static TimelineMedia? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'media_id'), 'Required key "TimelineMedia[media_id]" is missing from JSON.');
        assert(json[r'media_id'] != null, 'Required key "TimelineMedia[media_id]" has a null value in JSON.');
        assert(json.containsKey(r'content_type'), 'Required key "TimelineMedia[content_type]" is missing from JSON.');
        assert(json[r'content_type'] != null, 'Required key "TimelineMedia[content_type]" has a null value in JSON.');
        assert(json.containsKey(r'url'), 'Required key "TimelineMedia[url]" is missing from JSON.');
        assert(json[r'url'] != null, 'Required key "TimelineMedia[url]" has a null value in JSON.');
        assert(json.containsKey(r'thumbnail_url'), 'Required key "TimelineMedia[thumbnail_url]" is missing from JSON.');
        assert(json.containsKey(r'size_bytes'), 'Required key "TimelineMedia[size_bytes]" is missing from JSON.');
        assert(json[r'size_bytes'] != null, 'Required key "TimelineMedia[size_bytes]" has a null value in JSON.');
        return true;
      }());

      return TimelineMedia(
        mediaId: mapValueOfType<String>(json, r'media_id')!,
        contentType: TimelineMediaContentTypeEnum.fromJson(json[r'content_type'])!,
        url: mapValueOfType<String>(json, r'url')!,
        thumbnailUrl: mapValueOfType<String>(json, r'thumbnail_url'),
        sizeBytes: mapValueOfType<int>(json, r'size_bytes')!,
      );
    }
    return null;
  }

  static List<TimelineMedia> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelineMedia>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelineMedia.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, TimelineMedia> mapFromJson(dynamic json) {
    final map = <String, TimelineMedia>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = TimelineMedia.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of TimelineMedia-objects as value to a dart map
  static Map<String, List<TimelineMedia>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<TimelineMedia>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = TimelineMedia.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'media_id',
    'content_type',
    'url',
    'thumbnail_url',
    'size_bytes',
  };
}


enum TimelineMediaContentTypeEnum {
  imageSlashJpeg._(r'image/jpeg'),
  imageSlashPng._(r'image/png'),
  imageSlashWebp._(r'image/webp'),
  imageSlashHeic._(r'image/heic'),
  videoSlashMp4._(r'video/mp4'),
  ;

  /// Instantiate a new enum with the provided value.
  const TimelineMediaContentTypeEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [TimelineMediaContentTypeEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static TimelineMediaContentTypeEnum? fromJson(dynamic value) => TimelineMediaContentTypeEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [TimelineMediaContentTypeEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<TimelineMediaContentTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelineMediaContentTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelineMediaContentTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [TimelineMediaContentTypeEnum] to String,
/// and [decode] dynamic data back to [TimelineMediaContentTypeEnum].
class TimelineMediaContentTypeEnumTypeTransformer {
  factory TimelineMediaContentTypeEnumTypeTransformer() => _instance ??= const TimelineMediaContentTypeEnumTypeTransformer._();

  const TimelineMediaContentTypeEnumTypeTransformer._();

  String encode(TimelineMediaContentTypeEnum data) => data._value;

  /// Returns the instance of [TimelineMediaContentTypeEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TimelineMediaContentTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is TimelineMediaContentTypeEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'image/jpeg': return TimelineMediaContentTypeEnum.imageSlashJpeg;
        case r'image/png': return TimelineMediaContentTypeEnum.imageSlashPng;
        case r'image/webp': return TimelineMediaContentTypeEnum.imageSlashWebp;
        case r'image/heic': return TimelineMediaContentTypeEnum.imageSlashHeic;
        case r'video/mp4': return TimelineMediaContentTypeEnum.videoSlashMp4;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static TimelineMediaContentTypeEnumTypeTransformer? _instance;
}


