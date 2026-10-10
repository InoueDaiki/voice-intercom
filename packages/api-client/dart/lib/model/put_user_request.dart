//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PutUserRequest {
  /// Returns a new [PutUserRequest] instance.
  PutUserRequest({
    required this.displayName,
    required this.language,
  });

  /// 表示名
  String displayName;

  PutUserRequestLanguageEnum language;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PutUserRequest &&
    other.displayName == displayName &&
    other.language == language;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (displayName.hashCode) +
    (language.hashCode);

  @override
  String toString() => 'PutUserRequest[displayName=$displayName, language=$language]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'display_name'] = this.displayName;
      json[r'language'] = this.language;
    return json;
  }

  /// Returns a new [PutUserRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PutUserRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'display_name'), 'Required key "PutUserRequest[display_name]" is missing from JSON.');
        assert(json[r'display_name'] != null, 'Required key "PutUserRequest[display_name]" has a null value in JSON.');
        assert(json.containsKey(r'language'), 'Required key "PutUserRequest[language]" is missing from JSON.');
        assert(json[r'language'] != null, 'Required key "PutUserRequest[language]" has a null value in JSON.');
        return true;
      }());

      return PutUserRequest(
        displayName: mapValueOfType<String>(json, r'display_name')!,
        language: PutUserRequestLanguageEnum.fromJson(json[r'language'])!,
      );
    }
    return null;
  }

  static List<PutUserRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PutUserRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PutUserRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PutUserRequest> mapFromJson(dynamic json) {
    final map = <String, PutUserRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PutUserRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PutUserRequest-objects as value to a dart map
  static Map<String, List<PutUserRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PutUserRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PutUserRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'display_name',
    'language',
  };
}


enum PutUserRequestLanguageEnum {
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
  const PutUserRequestLanguageEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [PutUserRequestLanguageEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static PutUserRequestLanguageEnum? fromJson(dynamic value) => PutUserRequestLanguageEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [PutUserRequestLanguageEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<PutUserRequestLanguageEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PutUserRequestLanguageEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PutUserRequestLanguageEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [PutUserRequestLanguageEnum] to String,
/// and [decode] dynamic data back to [PutUserRequestLanguageEnum].
class PutUserRequestLanguageEnumTypeTransformer {
  factory PutUserRequestLanguageEnumTypeTransformer() => _instance ??= const PutUserRequestLanguageEnumTypeTransformer._();

  const PutUserRequestLanguageEnumTypeTransformer._();

  String encode(PutUserRequestLanguageEnum data) => data._value;

  /// Returns the instance of [PutUserRequestLanguageEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  PutUserRequestLanguageEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is PutUserRequestLanguageEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'es': return PutUserRequestLanguageEnum.es;
        case r'pt': return PutUserRequestLanguageEnum.pt;
        case r'fr': return PutUserRequestLanguageEnum.fr;
        case r'ja': return PutUserRequestLanguageEnum.ja;
        case r'ru': return PutUserRequestLanguageEnum.ru;
        case r'zh': return PutUserRequestLanguageEnum.zh;
        case r'de': return PutUserRequestLanguageEnum.de;
        case r'ko': return PutUserRequestLanguageEnum.ko;
        case r'hi': return PutUserRequestLanguageEnum.hi;
        case r'id': return PutUserRequestLanguageEnum.id;
        case r'vi': return PutUserRequestLanguageEnum.vi;
        case r'it': return PutUserRequestLanguageEnum.it;
        case r'en': return PutUserRequestLanguageEnum.en;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static PutUserRequestLanguageEnumTypeTransformer? _instance;
}


