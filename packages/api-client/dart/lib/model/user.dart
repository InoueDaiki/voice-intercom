//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class User {
  /// Returns a new [User] instance.
  User({
    required this.userId,
    required this.displayName,
    required this.language,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Cognito の sub
  String userId;

  /// 表示名
  String displayName;

  /// 話す言語。翻訳音声もこの言語で聞く
  UserLanguageEnum language;

  /// ISO 8601(UTC)
  String createdAt;

  /// ISO 8601(UTC)
  String updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is User &&
    other.userId == userId &&
    other.displayName == displayName &&
    other.language == language &&
    other.createdAt == createdAt &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (userId.hashCode) +
    (displayName.hashCode) +
    (language.hashCode) +
    (createdAt.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'User[userId=$userId, displayName=$displayName, language=$language, createdAt=$createdAt, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'user_id'] = this.userId;
      json[r'display_name'] = this.displayName;
      json[r'language'] = this.language;
      json[r'created_at'] = this.createdAt;
      json[r'updated_at'] = this.updatedAt;
    return json;
  }

  /// Returns a new [User] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static User? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'user_id'), 'Required key "User[user_id]" is missing from JSON.');
        assert(json[r'user_id'] != null, 'Required key "User[user_id]" has a null value in JSON.');
        assert(json.containsKey(r'display_name'), 'Required key "User[display_name]" is missing from JSON.');
        assert(json[r'display_name'] != null, 'Required key "User[display_name]" has a null value in JSON.');
        assert(json.containsKey(r'language'), 'Required key "User[language]" is missing from JSON.');
        assert(json[r'language'] != null, 'Required key "User[language]" has a null value in JSON.');
        assert(json.containsKey(r'created_at'), 'Required key "User[created_at]" is missing from JSON.');
        assert(json[r'created_at'] != null, 'Required key "User[created_at]" has a null value in JSON.');
        assert(json.containsKey(r'updated_at'), 'Required key "User[updated_at]" is missing from JSON.');
        assert(json[r'updated_at'] != null, 'Required key "User[updated_at]" has a null value in JSON.');
        return true;
      }());

      return User(
        userId: mapValueOfType<String>(json, r'user_id')!,
        displayName: mapValueOfType<String>(json, r'display_name')!,
        language: UserLanguageEnum.fromJson(json[r'language'])!,
        createdAt: mapValueOfType<String>(json, r'created_at')!,
        updatedAt: mapValueOfType<String>(json, r'updated_at')!,
      );
    }
    return null;
  }

  static List<User> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <User>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = User.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, User> mapFromJson(dynamic json) {
    final map = <String, User>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = User.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of User-objects as value to a dart map
  static Map<String, List<User>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<User>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = User.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'user_id',
    'display_name',
    'language',
    'created_at',
    'updated_at',
  };
}

/// 話す言語。翻訳音声もこの言語で聞く
enum UserLanguageEnum {
  es._(r'es'),
  pt._(r'pt'),
  fr._(r'fr'),
  ja._(r'ja'),
  ru._(r'ru'),
  zh._(r'zh'),
  de._(r'de'),
  ko._(r'ko'),
  hi._(r'hi'),
  id._(r'id'),
  vi._(r'vi'),
  it._(r'it'),
  en._(r'en'),
  ;

  /// Instantiate a new enum with the provided value.
  const UserLanguageEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [UserLanguageEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static UserLanguageEnum? fromJson(dynamic value) => UserLanguageEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [UserLanguageEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<UserLanguageEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <UserLanguageEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = UserLanguageEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [UserLanguageEnum] to String,
/// and [decode] dynamic data back to [UserLanguageEnum].
class UserLanguageEnumTypeTransformer {
  factory UserLanguageEnumTypeTransformer() => _instance ??= const UserLanguageEnumTypeTransformer._();

  const UserLanguageEnumTypeTransformer._();

  String encode(UserLanguageEnum data) => data._value;

  /// Returns the instance of [UserLanguageEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  UserLanguageEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is UserLanguageEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'es': return UserLanguageEnum.es;
        case r'pt': return UserLanguageEnum.pt;
        case r'fr': return UserLanguageEnum.fr;
        case r'ja': return UserLanguageEnum.ja;
        case r'ru': return UserLanguageEnum.ru;
        case r'zh': return UserLanguageEnum.zh;
        case r'de': return UserLanguageEnum.de;
        case r'ko': return UserLanguageEnum.ko;
        case r'hi': return UserLanguageEnum.hi;
        case r'id': return UserLanguageEnum.id;
        case r'vi': return UserLanguageEnum.vi;
        case r'it': return UserLanguageEnum.it;
        case r'en': return UserLanguageEnum.en;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static UserLanguageEnumTypeTransformer? _instance;
}


