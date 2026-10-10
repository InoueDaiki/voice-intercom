//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class RegisterDeviceRequest {
  /// Returns a new [RegisterDeviceRequest] instance.
  RegisterDeviceRequest({
    required this.token,
    required this.platform,
  });

  /// FCM の登録トークン(firebase_messaging の getToken())
  String token;

  /// 端末の OS。通知の送り方(優先度)を分ける
  RegisterDeviceRequestPlatformEnum platform;

  @override
  bool operator ==(Object other) => identical(this, other) || other is RegisterDeviceRequest &&
    other.token == token &&
    other.platform == platform;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (token.hashCode) +
    (platform.hashCode);

  @override
  String toString() => 'RegisterDeviceRequest[token=$token, platform=$platform]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'token'] = this.token;
      json[r'platform'] = this.platform;
    return json;
  }

  /// Returns a new [RegisterDeviceRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static RegisterDeviceRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'token'), 'Required key "RegisterDeviceRequest[token]" is missing from JSON.');
        assert(json[r'token'] != null, 'Required key "RegisterDeviceRequest[token]" has a null value in JSON.');
        assert(json.containsKey(r'platform'), 'Required key "RegisterDeviceRequest[platform]" is missing from JSON.');
        assert(json[r'platform'] != null, 'Required key "RegisterDeviceRequest[platform]" has a null value in JSON.');
        return true;
      }());

      return RegisterDeviceRequest(
        token: mapValueOfType<String>(json, r'token')!,
        platform: RegisterDeviceRequestPlatformEnum.fromJson(json[r'platform'])!,
      );
    }
    return null;
  }

  static List<RegisterDeviceRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RegisterDeviceRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RegisterDeviceRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, RegisterDeviceRequest> mapFromJson(dynamic json) {
    final map = <String, RegisterDeviceRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = RegisterDeviceRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of RegisterDeviceRequest-objects as value to a dart map
  static Map<String, List<RegisterDeviceRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<RegisterDeviceRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = RegisterDeviceRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'token',
    'platform',
  };
}

/// 端末の OS。通知の送り方(優先度)を分ける
enum RegisterDeviceRequestPlatformEnum {
  ios._(r'ios'),
  android._(r'android'),
  ;

  /// Instantiate a new enum with the provided value.
  const RegisterDeviceRequestPlatformEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [RegisterDeviceRequestPlatformEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static RegisterDeviceRequestPlatformEnum? fromJson(dynamic value) => RegisterDeviceRequestPlatformEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [RegisterDeviceRequestPlatformEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<RegisterDeviceRequestPlatformEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <RegisterDeviceRequestPlatformEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = RegisterDeviceRequestPlatformEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [RegisterDeviceRequestPlatformEnum] to String,
/// and [decode] dynamic data back to [RegisterDeviceRequestPlatformEnum].
class RegisterDeviceRequestPlatformEnumTypeTransformer {
  factory RegisterDeviceRequestPlatformEnumTypeTransformer() => _instance ??= const RegisterDeviceRequestPlatformEnumTypeTransformer._();

  const RegisterDeviceRequestPlatformEnumTypeTransformer._();

  String encode(RegisterDeviceRequestPlatformEnum data) => data._value;

  /// Returns the instance of [RegisterDeviceRequestPlatformEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  RegisterDeviceRequestPlatformEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is RegisterDeviceRequestPlatformEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'ios': return RegisterDeviceRequestPlatformEnum.ios;
        case r'android': return RegisterDeviceRequestPlatformEnum.android;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static RegisterDeviceRequestPlatformEnumTypeTransformer? _instance;
}


