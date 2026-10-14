//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class CreateMediaUploadRequest {
  /// Returns a new [CreateMediaUploadRequest] instance.
  CreateMediaUploadRequest({
    required this.contentType,
    required this.sizeBytes,
    this.hasThumbnail = false,
    this.width,
    this.height,
    this.durationMs,
  });

  CreateMediaUploadRequestContentTypeEnum contentType;

  /// 本体のバイト数(上限 100MB。マルチパートは未対応)
  ///
  /// Minimum value: 0
  /// Maximum value: 104857600
  int sizeBytes;

  /// サムネイル(image/jpeg)も上げるなら true
  bool hasThumbnail;

  /// 表示の幅(ピクセル。向きを反映した後。height と一緒に送る)。分からなければ null
  ///
  /// Minimum value: 1
  /// Maximum value: 65535
  int? width;

  /// 表示の高さ(ピクセル。向きを反映した後。width と一緒に送る)。分からなければ null
  ///
  /// Minimum value: 1
  /// Maximum value: 65535
  int? height;

  /// 動画の長さ(ミリ秒。動画のときだけ)。画像と、分からないときは null
  ///
  /// Minimum value: 1
  /// Maximum value: 86400000
  int? durationMs;

  @override
  bool operator ==(Object other) => identical(this, other) || other is CreateMediaUploadRequest &&
    other.contentType == contentType &&
    other.sizeBytes == sizeBytes &&
    other.hasThumbnail == hasThumbnail &&
    other.width == width &&
    other.height == height &&
    other.durationMs == durationMs;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (contentType.hashCode) +
    (sizeBytes.hashCode) +
    (hasThumbnail.hashCode) +
    (width == null ? 0 : width!.hashCode) +
    (height == null ? 0 : height!.hashCode) +
    (durationMs == null ? 0 : durationMs!.hashCode);

  @override
  String toString() => 'CreateMediaUploadRequest[contentType=$contentType, sizeBytes=$sizeBytes, hasThumbnail=$hasThumbnail, width=$width, height=$height, durationMs=$durationMs]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'content_type'] = this.contentType;
      json[r'size_bytes'] = this.sizeBytes;
      json[r'has_thumbnail'] = this.hasThumbnail;
    if (this.width != null) {
      json[r'width'] = this.width;
    } else {
      json[r'width'] = null;
    }
    if (this.height != null) {
      json[r'height'] = this.height;
    } else {
      json[r'height'] = null;
    }
    if (this.durationMs != null) {
      json[r'duration_ms'] = this.durationMs;
    } else {
      json[r'duration_ms'] = null;
    }
    return json;
  }

  /// Returns a new [CreateMediaUploadRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static CreateMediaUploadRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'content_type'), 'Required key "CreateMediaUploadRequest[content_type]" is missing from JSON.');
        assert(json[r'content_type'] != null, 'Required key "CreateMediaUploadRequest[content_type]" has a null value in JSON.');
        assert(json.containsKey(r'size_bytes'), 'Required key "CreateMediaUploadRequest[size_bytes]" is missing from JSON.');
        assert(json[r'size_bytes'] != null, 'Required key "CreateMediaUploadRequest[size_bytes]" has a null value in JSON.');
        return true;
      }());

      return CreateMediaUploadRequest(
        contentType: CreateMediaUploadRequestContentTypeEnum.fromJson(json[r'content_type'])!,
        sizeBytes: mapValueOfType<int>(json, r'size_bytes')!,
        hasThumbnail: mapValueOfType<bool>(json, r'has_thumbnail') ?? false,
        width: mapValueOfType<int>(json, r'width'),
        height: mapValueOfType<int>(json, r'height'),
        durationMs: mapValueOfType<int>(json, r'duration_ms'),
      );
    }
    return null;
  }

  static List<CreateMediaUploadRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <CreateMediaUploadRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = CreateMediaUploadRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, CreateMediaUploadRequest> mapFromJson(dynamic json) {
    final map = <String, CreateMediaUploadRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = CreateMediaUploadRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of CreateMediaUploadRequest-objects as value to a dart map
  static Map<String, List<CreateMediaUploadRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<CreateMediaUploadRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = CreateMediaUploadRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'content_type',
    'size_bytes',
  };
}


enum CreateMediaUploadRequestContentTypeEnum {
  imageSlashJpeg._(r'image/jpeg'),
  imageSlashPng._(r'image/png'),
  imageSlashWebp._(r'image/webp'),
  imageSlashHeic._(r'image/heic'),
  videoSlashMp4._(r'video/mp4'),
  ;

  /// Instantiate a new enum with the provided value.
  const CreateMediaUploadRequestContentTypeEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [CreateMediaUploadRequestContentTypeEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static CreateMediaUploadRequestContentTypeEnum? fromJson(dynamic value) => CreateMediaUploadRequestContentTypeEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [CreateMediaUploadRequestContentTypeEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<CreateMediaUploadRequestContentTypeEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <CreateMediaUploadRequestContentTypeEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = CreateMediaUploadRequestContentTypeEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [CreateMediaUploadRequestContentTypeEnum] to String,
/// and [decode] dynamic data back to [CreateMediaUploadRequestContentTypeEnum].
class CreateMediaUploadRequestContentTypeEnumTypeTransformer {
  factory CreateMediaUploadRequestContentTypeEnumTypeTransformer() => _instance ??= const CreateMediaUploadRequestContentTypeEnumTypeTransformer._();

  const CreateMediaUploadRequestContentTypeEnumTypeTransformer._();

  String encode(CreateMediaUploadRequestContentTypeEnum data) => data._value;

  /// Returns the instance of [CreateMediaUploadRequestContentTypeEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  CreateMediaUploadRequestContentTypeEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is CreateMediaUploadRequestContentTypeEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'image/jpeg': return CreateMediaUploadRequestContentTypeEnum.imageSlashJpeg;
        case r'image/png': return CreateMediaUploadRequestContentTypeEnum.imageSlashPng;
        case r'image/webp': return CreateMediaUploadRequestContentTypeEnum.imageSlashWebp;
        case r'image/heic': return CreateMediaUploadRequestContentTypeEnum.imageSlashHeic;
        case r'video/mp4': return CreateMediaUploadRequestContentTypeEnum.videoSlashMp4;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static CreateMediaUploadRequestContentTypeEnumTypeTransformer? _instance;
}


