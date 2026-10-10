//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class TimelinePage {
  /// Returns a new [TimelinePage] instance.
  TimelinePage({
    this.items = const [],
    required this.nextBefore,
  });

  /// 新しい順
  List<TimelineEvent> items;

  /// 続き(より古いもの)を取るときに before に渡す。続きがなければ null
  String? nextBefore;

  @override
  bool operator ==(Object other) => identical(this, other) || other is TimelinePage &&
    _deepEquality.equals(other.items, items) &&
    other.nextBefore == nextBefore;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (items.hashCode) +
    (nextBefore == null ? 0 : nextBefore!.hashCode);

  @override
  String toString() => 'TimelinePage[items=$items, nextBefore=$nextBefore]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'items'] = this.items;
    if (this.nextBefore != null) {
      json[r'next_before'] = this.nextBefore;
    } else {
      json[r'next_before'] = null;
    }
    return json;
  }

  /// Returns a new [TimelinePage] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static TimelinePage? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        assert(json.containsKey(r'items'), 'Required key "TimelinePage[items]" is missing from JSON.');
        assert(json[r'items'] != null, 'Required key "TimelinePage[items]" has a null value in JSON.');
        assert(json.containsKey(r'next_before'), 'Required key "TimelinePage[next_before]" is missing from JSON.');
        return true;
      }());

      return TimelinePage(
        items: TimelineEvent.listFromJson(json[r'items']),
        nextBefore: mapValueOfType<String>(json, r'next_before'),
      );
    }
    return null;
  }

  static List<TimelinePage> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimelinePage>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimelinePage.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, TimelinePage> mapFromJson(dynamic json) {
    final map = <String, TimelinePage>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = TimelinePage.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of TimelinePage-objects as value to a dart map
  static Map<String, List<TimelinePage>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<TimelinePage>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = TimelinePage.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'items',
    'next_before',
  };
}

