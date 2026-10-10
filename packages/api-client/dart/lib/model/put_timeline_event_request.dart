//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PutTimelineEventRequest {
  /// Returns a new [PutTimelineEventRequest] instance.
  PutTimelineEventRequest({
    required this.kind,
    required this.senderId,
    required this.occurredAt,
    required this.language,
    required this.text,
    this.translations = const {},
    this.utteranceId,
    this.segmentIndex,
  });

  PutTimelineEventRequestKindEnum kind;

  /// 話者・送信者の Cognito の sub(LiveKit の identity と同じ)
  String senderId;

  /// ISO 8601(UTC、ミリ秒まで。例 2026-10-10T00:00:00.000Z)。リクエストではタイムゾーンつきの ISO 8601 を受け付け、この形にそろえる
  String occurredAt;

  /// 原文の言語。分からなければ null
  PutTimelineEventRequestLanguageEnum? language;

  /// 原文
  String text;

  /// 言語コード → 訳文。訳がなければ空
  Map<String, String> translations;

  /// 発話の ID(utterance のときだけ。字幕の proto と同じ)
  String? utteranceId;

  /// 発話の中の区切りの番号(utterance のときだけ。字幕の proto と同じ)
  ///
  /// Minimum value: 0
  int? segmentIndex;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PutTimelineEventRequest &&
    other.kind == kind &&
    other.senderId == senderId &&
    other.occurredAt == occurredAt &&
    other.language == language &&
    other.text == text &&
    _deepEquality.equals(other.translations, translations) &&
    other.utteranceId == utteranceId &&
    other.segmentIndex == segmentIndex;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (kind.hashCode) +
    (senderId.hashCode) +
    (occurredAt.hashCode) +
    (language == null ? 0 : language!.hashCode) +
    (text.hashCode) +
    (translations.hashCode) +
    (utteranceId == null ? 0 : utteranceId!.hashCode) +
    (segmentIndex == null ? 0 : segmentIndex!.hashCode);

  @override
  String toString() => 'PutTimelineEventRequest[kind=$kind, senderId=$senderId, occurredAt=$occurredAt, language=$language, text=$text, translations=$translations, utteranceId=$utteranceId, segmentIndex=$segmentIndex]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'kind'] = this.kind;
      json[r'sender_id'] = this.senderId;
      json[r'occurred_at'] = this.occurredAt;
    if (this.language != null) {
      json[r'language'] = this.language;
    } else {
      json[r'language'] = null;
    }
      json[r'text'] = this.text;
      json[r'translations'] = this.translations;
    if (this.utteranceId != null) {
      json[r'utterance_id'] = this.utteranceId;
    } else {
      json[r'utterance_id'] = null;
    }
    if (this.segmentIndex != null) {
      json[r'segment_index'] = this.segmentIndex;
    } else {
      json[r'segment_index'] = null;
    }
    return json;
  }

  /// Returns a new [PutTimelineEventRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PutTimelineEventRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'kind'), 'Required key "PutTimelineEventRequest[kind]" is missing from JSON.');
        assert(json[r'kind'] != null, 'Required key "PutTimelineEventRequest[kind]" has a null value in JSON.');
        assert(json.containsKey(r'sender_id'), 'Required key "PutTimelineEventRequest[sender_id]" is missing from JSON.');
        assert(json[r'sender_id'] != null, 'Required key "PutTimelineEventRequest[sender_id]" has a null value in JSON.');
        assert(json.containsKey(r'occurred_at'), 'Required key "PutTimelineEventRequest[occurred_at]" is missing from JSON.');
        assert(json[r'occurred_at'] != null, 'Required key "PutTimelineEventRequest[occurred_at]" has a null value in JSON.');
        assert(json.containsKey(r'language'), 'Required key "PutTimelineEventRequest[language]" is missing from JSON.');
        assert(json.containsKey(r'text'), 'Required key "PutTimelineEventRequest[text]" is missing from JSON.');
        assert(json[r'text'] != null, 'Required key "PutTimelineEventRequest[text]" has a null value in JSON.');
        assert(json.containsKey(r'translations'), 'Required key "PutTimelineEventRequest[translations]" is missing from JSON.');
        assert(json[r'translations'] != null, 'Required key "PutTimelineEventRequest[translations]" has a null value in JSON.');
        return true;
      }());

      return PutTimelineEventRequest(
        kind: PutTimelineEventRequestKindEnum.fromJson(json[r'kind'])!,
        senderId: mapValueOfType<String>(json, r'sender_id')!,
        occurredAt: mapValueOfType<String>(json, r'occurred_at')!,
        language: PutTimelineEventRequestLanguageEnum.fromJson(json[r'language']),
        text: mapValueOfType<String>(json, r'text')!,
        translations: mapCastOfType<String, String>(json, r'translations')!,
        utteranceId: mapValueOfType<String>(json, r'utterance_id'),
        segmentIndex: mapValueOfType<int>(json, r'segment_index'),
      );
    }
    return null;
  }

  static List<PutTimelineEventRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PutTimelineEventRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PutTimelineEventRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PutTimelineEventRequest> mapFromJson(dynamic json) {
    final map = <String, PutTimelineEventRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PutTimelineEventRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PutTimelineEventRequest-objects as value to a dart map
  static Map<String, List<PutTimelineEventRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PutTimelineEventRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PutTimelineEventRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'kind',
    'sender_id',
    'occurred_at',
    'language',
    'text',
    'translations',
  };
}


enum PutTimelineEventRequestKindEnum {
  utterance._(r'utterance'),
  text._(r'text'),
  ;

  /// Instantiate a new enum with the provided value.
  const PutTimelineEventRequestKindEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [PutTimelineEventRequestKindEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static PutTimelineEventRequestKindEnum? fromJson(dynamic value) => PutTimelineEventRequestKindEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [PutTimelineEventRequestKindEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<PutTimelineEventRequestKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PutTimelineEventRequestKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PutTimelineEventRequestKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [PutTimelineEventRequestKindEnum] to String,
/// and [decode] dynamic data back to [PutTimelineEventRequestKindEnum].
class PutTimelineEventRequestKindEnumTypeTransformer {
  factory PutTimelineEventRequestKindEnumTypeTransformer() => _instance ??= const PutTimelineEventRequestKindEnumTypeTransformer._();

  const PutTimelineEventRequestKindEnumTypeTransformer._();

  String encode(PutTimelineEventRequestKindEnum data) => data._value;

  /// Returns the instance of [PutTimelineEventRequestKindEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  PutTimelineEventRequestKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is PutTimelineEventRequestKindEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'utterance': return PutTimelineEventRequestKindEnum.utterance;
        case r'text': return PutTimelineEventRequestKindEnum.text;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static PutTimelineEventRequestKindEnumTypeTransformer? _instance;
}


/// 原文の言語。分からなければ null
enum PutTimelineEventRequestLanguageEnum {
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
  const PutTimelineEventRequestLanguageEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [PutTimelineEventRequestLanguageEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static PutTimelineEventRequestLanguageEnum? fromJson(dynamic value) => PutTimelineEventRequestLanguageEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [PutTimelineEventRequestLanguageEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<PutTimelineEventRequestLanguageEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PutTimelineEventRequestLanguageEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PutTimelineEventRequestLanguageEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [PutTimelineEventRequestLanguageEnum] to String,
/// and [decode] dynamic data back to [PutTimelineEventRequestLanguageEnum].
class PutTimelineEventRequestLanguageEnumTypeTransformer {
  factory PutTimelineEventRequestLanguageEnumTypeTransformer() => _instance ??= const PutTimelineEventRequestLanguageEnumTypeTransformer._();

  const PutTimelineEventRequestLanguageEnumTypeTransformer._();

  String encode(PutTimelineEventRequestLanguageEnum data) => data._value;

  /// Returns the instance of [PutTimelineEventRequestLanguageEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  PutTimelineEventRequestLanguageEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is PutTimelineEventRequestLanguageEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'es': return PutTimelineEventRequestLanguageEnum.es;
        case r'pt': return PutTimelineEventRequestLanguageEnum.pt;
        case r'fr': return PutTimelineEventRequestLanguageEnum.fr;
        case r'ja': return PutTimelineEventRequestLanguageEnum.ja;
        case r'ru': return PutTimelineEventRequestLanguageEnum.ru;
        case r'zh': return PutTimelineEventRequestLanguageEnum.zh;
        case r'de': return PutTimelineEventRequestLanguageEnum.de;
        case r'ko': return PutTimelineEventRequestLanguageEnum.ko;
        case r'hi': return PutTimelineEventRequestLanguageEnum.hi;
        case r'id': return PutTimelineEventRequestLanguageEnum.id;
        case r'vi': return PutTimelineEventRequestLanguageEnum.vi;
        case r'it': return PutTimelineEventRequestLanguageEnum.it;
        case r'en': return PutTimelineEventRequestLanguageEnum.en;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static PutTimelineEventRequestLanguageEnumTypeTransformer? _instance;
}


