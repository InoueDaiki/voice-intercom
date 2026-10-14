//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class TimelineEvent {
  /// Returns a new [TimelineEvent] instance.
  TimelineEvent({
    required this.roomId,
    required this.eventId,
    required this.kind,
    required this.senderId,
    required this.occurredAt,
    required this.language,
    required this.text,
    this.translations = const {},
    required this.utteranceId,
    required this.segmentIndex,
    required this.media,
    this.messageId,
    this.deleted,
  });

  String roomId;

  /// `<occurred_at>#<source_id>`。文字列の順が時刻の順になる。ページングの before に渡す
  String eventId;

  /// utterance は音声の発話(字幕の区切りごとに1件)、text はテキスト入力、media は画像・動画
  TimelineEventKindEnum kind;

  /// 話者・送信者の Cognito の sub(LiveKit の identity と同じ)
  String senderId;

  /// ISO 8601(UTC、ミリ秒まで。例 2026-10-10T00:00:00.000Z)
  String occurredAt;

  /// 原文の言語。分からなければ null
  TimelineEventLanguageEnum? language;

  /// 原文。media では常に空文字(画像・動画には文を添えられない)
  String text;

  /// 言語コード → 訳文。訳がなければ空
  Map<String, String> translations;

  /// 発話の ID(utterance のときだけ。字幕の proto と同じ)
  String? utteranceId;

  /// 発話の中の区切りの番号(utterance のときだけ。字幕の proto と同じ)
  ///
  /// Minimum value: 0
  int? segmentIndex;

  /// media のときだけ。消した行では null
  TimelineMedia? media;

  /// テキスト入力のときだけ。送信者のアプリが振った TextMessage の message_id(字幕の Caption の message_id と同じ)。アプリが自分の送ったテキストの行を見つけるのに使う
  String? messageId;

  /// 送った本人が消した行なら、その印。text、translations、media は空になる
  TimelineDeletion? deleted;

  @override
  bool operator ==(Object other) => identical(this, other) || other is TimelineEvent &&
    other.roomId == roomId &&
    other.eventId == eventId &&
    other.kind == kind &&
    other.senderId == senderId &&
    other.occurredAt == occurredAt &&
    other.language == language &&
    other.text == text &&
    _deepEquality.equals(other.translations, translations) &&
    other.utteranceId == utteranceId &&
    other.segmentIndex == segmentIndex &&
    other.media == media &&
    other.messageId == messageId &&
    other.deleted == deleted;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (roomId.hashCode) +
    (eventId.hashCode) +
    (kind.hashCode) +
    (senderId.hashCode) +
    (occurredAt.hashCode) +
    (language == null ? 0 : language!.hashCode) +
    (text.hashCode) +
    (translations.hashCode) +
    (utteranceId == null ? 0 : utteranceId!.hashCode) +
    (segmentIndex == null ? 0 : segmentIndex!.hashCode) +
    (media == null ? 0 : media!.hashCode) +
    (messageId == null ? 0 : messageId!.hashCode) +
    (deleted == null ? 0 : deleted!.hashCode);

  @override
  String toString() => 'TimelineEvent[roomId=$roomId, eventId=$eventId, kind=$kind, senderId=$senderId, occurredAt=$occurredAt, language=$language, text=$text, translations=$translations, utteranceId=$utteranceId, segmentIndex=$segmentIndex, media=$media, messageId=$messageId, deleted=$deleted]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'room_id'] = this.roomId;
      json[r'event_id'] = this.eventId;
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
    if (this.media != null) {
      json[r'media'] = this.media;
    } else {
      json[r'media'] = null;
    }
    if (this.messageId != null) {
      json[r'message_id'] = this.messageId;
    } else {
      json[r'message_id'] = null;
    }
    if (this.deleted != null) {
      json[r'deleted'] = this.deleted;
    } else {
      json[r'deleted'] = null;
    }
    return json;
  }

  /// Returns a new [TimelineEvent] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static TimelineEvent? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'room_id'), 'Required key "TimelineEvent[room_id]" is missing from JSON.');
        assert(json[r'room_id'] != null, 'Required key "TimelineEvent[room_id]" has a null value in JSON.');
        assert(json.containsKey(r'event_id'), 'Required key "TimelineEvent[event_id]" is missing from JSON.');
        assert(json[r'event_id'] != null, 'Required key "TimelineEvent[event_id]" has a null value in JSON.');
        assert(json.containsKey(r'kind'), 'Required key "TimelineEvent[kind]" is missing from JSON.');
        assert(json[r'kind'] != null, 'Required key "TimelineEvent[kind]" has a null value in JSON.');
        assert(json.containsKey(r'sender_id'), 'Required key "TimelineEvent[sender_id]" is missing from JSON.');
        assert(json[r'sender_id'] != null, 'Required key "TimelineEvent[sender_id]" has a null value in JSON.');
        assert(json.containsKey(r'occurred_at'), 'Required key "TimelineEvent[occurred_at]" is missing from JSON.');
        assert(json[r'occurred_at'] != null, 'Required key "TimelineEvent[occurred_at]" has a null value in JSON.');
        assert(json.containsKey(r'language'), 'Required key "TimelineEvent[language]" is missing from JSON.');
        assert(json.containsKey(r'text'), 'Required key "TimelineEvent[text]" is missing from JSON.');
        assert(json[r'text'] != null, 'Required key "TimelineEvent[text]" has a null value in JSON.');
        assert(json.containsKey(r'translations'), 'Required key "TimelineEvent[translations]" is missing from JSON.');
        assert(json[r'translations'] != null, 'Required key "TimelineEvent[translations]" has a null value in JSON.');
        assert(json.containsKey(r'utterance_id'), 'Required key "TimelineEvent[utterance_id]" is missing from JSON.');
        assert(json.containsKey(r'segment_index'), 'Required key "TimelineEvent[segment_index]" is missing from JSON.');
        assert(json.containsKey(r'media'), 'Required key "TimelineEvent[media]" is missing from JSON.');
        return true;
      }());

      return TimelineEvent(
        roomId: mapValueOfType<String>(json, r'room_id')!,
        eventId: mapValueOfType<String>(json, r'event_id')!,
        kind: TimelineEventKindEnum.fromJson(json[r'kind'])!,
        senderId: mapValueOfType<String>(json, r'sender_id')!,
        occurredAt: mapValueOfType<String>(json, r'occurred_at')!,
        language: TimelineEventLanguageEnum.fromJson(json[r'language']),
        text: mapValueOfType<String>(json, r'text')!,
        translations: mapCastOfType<String, String>(json, r'translations')!,
        utteranceId: mapValueOfType<String>(json, r'utterance_id'),
        segmentIndex: mapValueOfType<int>(json, r'segment_index'),
        media: TimelineMedia.fromJson(json[r'media']),
        messageId: mapValueOfType<String>(json, r'message_id'),
        deleted: TimelineDeletion.fromJson(json[r'deleted']),
      );
    }
    return null;
  }

  static List<TimelineEvent> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelineEvent>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelineEvent.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, TimelineEvent> mapFromJson(dynamic json) {
    final map = <String, TimelineEvent>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = TimelineEvent.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of TimelineEvent-objects as value to a dart map
  static Map<String, List<TimelineEvent>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<TimelineEvent>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = TimelineEvent.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'room_id',
    'event_id',
    'kind',
    'sender_id',
    'occurred_at',
    'language',
    'text',
    'translations',
    'utterance_id',
    'segment_index',
    'media',
  };
}

/// utterance は音声の発話(字幕の区切りごとに1件)、text はテキスト入力、media は画像・動画
enum TimelineEventKindEnum {
  utterance._(r'utterance'),
  text._(r'text'),
  media._(r'media'),
  ;

  /// Instantiate a new enum with the provided value.
  const TimelineEventKindEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [TimelineEventKindEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static TimelineEventKindEnum? fromJson(dynamic value) => TimelineEventKindEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [TimelineEventKindEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<TimelineEventKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelineEventKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelineEventKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [TimelineEventKindEnum] to String,
/// and [decode] dynamic data back to [TimelineEventKindEnum].
class TimelineEventKindEnumTypeTransformer {
  factory TimelineEventKindEnumTypeTransformer() => _instance ??= const TimelineEventKindEnumTypeTransformer._();

  const TimelineEventKindEnumTypeTransformer._();

  String encode(TimelineEventKindEnum data) => data._value;

  /// Returns the instance of [TimelineEventKindEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TimelineEventKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is TimelineEventKindEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'utterance': return TimelineEventKindEnum.utterance;
        case r'text': return TimelineEventKindEnum.text;
        case r'media': return TimelineEventKindEnum.media;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static TimelineEventKindEnumTypeTransformer? _instance;
}


/// 原文の言語。分からなければ null
enum TimelineEventLanguageEnum {
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
  const TimelineEventLanguageEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [TimelineEventLanguageEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static TimelineEventLanguageEnum? fromJson(dynamic value) => TimelineEventLanguageEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [TimelineEventLanguageEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<TimelineEventLanguageEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelineEventLanguageEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelineEventLanguageEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [TimelineEventLanguageEnum] to String,
/// and [decode] dynamic data back to [TimelineEventLanguageEnum].
class TimelineEventLanguageEnumTypeTransformer {
  factory TimelineEventLanguageEnumTypeTransformer() => _instance ??= const TimelineEventLanguageEnumTypeTransformer._();

  const TimelineEventLanguageEnumTypeTransformer._();

  String encode(TimelineEventLanguageEnum data) => data._value;

  /// Returns the instance of [TimelineEventLanguageEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  TimelineEventLanguageEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is TimelineEventLanguageEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'es': return TimelineEventLanguageEnum.es;
        case r'pt': return TimelineEventLanguageEnum.pt;
        case r'fr': return TimelineEventLanguageEnum.fr;
        case r'ja': return TimelineEventLanguageEnum.ja;
        case r'ru': return TimelineEventLanguageEnum.ru;
        case r'zh': return TimelineEventLanguageEnum.zh;
        case r'de': return TimelineEventLanguageEnum.de;
        case r'ko': return TimelineEventLanguageEnum.ko;
        case r'hi': return TimelineEventLanguageEnum.hi;
        case r'id': return TimelineEventLanguageEnum.id;
        case r'vi': return TimelineEventLanguageEnum.vi;
        case r'it': return TimelineEventLanguageEnum.it;
        case r'en': return TimelineEventLanguageEnum.en;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static TimelineEventLanguageEnumTypeTransformer? _instance;
}


