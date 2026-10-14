//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class TimelineDeletion {
  /// Returns a new [TimelineDeletion] instance.
  TimelineDeletion({
    required this.deletedAt,
    required this.mediaType,
  });

  /// 消した時刻。ISO 8601(UTC、ミリ秒まで)
  String deletedAt;

  /// media のときだけ、画像か動画か(「削除された画像」「削除された動画」と出す)
  TimelineDeletionMediaTypeEnum? mediaType;

  @override
  bool operator ==(Object other) => identical(this, other) || other is TimelineDeletion &&
    other.deletedAt == deletedAt &&
    other.mediaType == mediaType;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (deletedAt.hashCode) +
    (mediaType == null ? 0 : mediaType!.hashCode);

  @override
  String toString() => 'TimelineDeletion[deletedAt=$deletedAt, mediaType=$mediaType]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'deleted_at'] = this.deletedAt;
    if (this.mediaType != null) {
      json[r'media_type'] = this.mediaType;
    } else {
      json[r'media_type'] = null;
    }
    return json;
  }

  /// Returns a new [TimelineDeletion] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static TimelineDeletion? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'deleted_at'), 'Required key "TimelineDeletion[deleted_at]" is missing from JSON.');
        assert(json[r'deleted_at'] != null, 'Required key "TimelineDeletion[deleted_at]" has a null value in JSON.');
        assert(json.containsKey(r'media_type'), 'Required key "TimelineDeletion[media_type]" is missing from JSON.');
        return true;
      }());

      return TimelineDeletion(
        deletedAt: mapValueOfType<String>(json, r'deleted_at')!,
        mediaType: TimelineDeletionMediaTypeEnum.fromJson(json[r'media_type']),
      );
    }
    return null;
  }

  static List<TimelineDeletion> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelineDeletion>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelineDeletion.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, TimelineDeletion> mapFromJson(dynamic json) {
    final map = <String, TimelineDeletion>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = TimelineDeletion.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of TimelineDeletion-objects as value to a dart map
  static Map<String, List<TimelineDeletion>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<TimelineDeletion>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = TimelineDeletion.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'deleted_at',
    'media_type',
  };
}

/// media のときだけ、画像か動画か(「削除された画像」「削除された動画」と出す)
enum TimelineDeletionMediaTypeEnum {
  image._(r'image'),
  video._(r'video'),
  ;

  /// Instantiate a new enum with the provided value.
  const TimelineDeletionMediaTypeEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [TimelineDeletionMediaTypeEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static TimelineDeletionMediaTypeEnum? fromJson(dynamic value) => TimelineDeletionMediaTypeEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [TimelineDeletionMediaTypeEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<TimelineDeletionMediaTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelineDeletionMediaTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelineDeletionMediaTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [TimelineDeletionMediaTypeEnum] to String,
/// and [decode] dynamic data back to [TimelineDeletionMediaTypeEnum].
class TimelineDeletionMediaTypeEnumTypeTransformer {
  factory TimelineDeletionMediaTypeEnumTypeTransformer() => _instance ??= const TimelineDeletionMediaTypeEnumTypeTransformer._();

  const TimelineDeletionMediaTypeEnumTypeTransformer._();

  String encode(TimelineDeletionMediaTypeEnum data) => data._value;

  /// Returns the instance of [TimelineDeletionMediaTypeEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TimelineDeletionMediaTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is TimelineDeletionMediaTypeEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'image': return TimelineDeletionMediaTypeEnum.image;
        case r'video': return TimelineDeletionMediaTypeEnum.video;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static TimelineDeletionMediaTypeEnumTypeTransformer? _instance;
}


