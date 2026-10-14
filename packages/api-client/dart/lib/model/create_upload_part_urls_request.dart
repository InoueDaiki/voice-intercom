//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class CreateUploadPartUrlsRequest {
  /// Returns a new [CreateUploadPartUrlsRequest] instance.
  CreateUploadPartUrlsRequest({
    this.partNumbers = const [],
    this.thumbnail = false,
  });

  /// 署名付き URL が要るパートの番号(1回で 100 個まで)
  List<int> partNumbers;

  /// サムネイルの署名付き URL も取り直すなら true
  bool thumbnail;

  @override
  bool operator ==(Object other) => identical(this, other) || other is CreateUploadPartUrlsRequest &&
    _deepEquality.equals(other.partNumbers, partNumbers) &&
    other.thumbnail == thumbnail;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (partNumbers.hashCode) +
    (thumbnail.hashCode);

  @override
  String toString() => 'CreateUploadPartUrlsRequest[partNumbers=$partNumbers, thumbnail=$thumbnail]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'part_numbers'] = this.partNumbers;
      json[r'thumbnail'] = this.thumbnail;
    return json;
  }

  /// Returns a new [CreateUploadPartUrlsRequest] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static CreateUploadPartUrlsRequest? fromJson(dynamic value) {
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      // Ensure that the map contains the required keys.
      // Note 1: the values aren't checked for validity beyond being non-null.
      // Note 2: this code is stripped in release mode!
      assert(() {
        return true;
      }());

      return CreateUploadPartUrlsRequest(
        partNumbers: json[r'part_numbers'] is Iterable
            ? (json[r'part_numbers'] as Iterable).cast<int>().toList(growable: false)
            : const [],
        thumbnail: mapValueOfType<bool>(json, r'thumbnail') ?? false,
      );
    }
    return null;
  }

  static List<CreateUploadPartUrlsRequest> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <CreateUploadPartUrlsRequest>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = CreateUploadPartUrlsRequest.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, CreateUploadPartUrlsRequest> mapFromJson(dynamic json) {
    final map = <String, CreateUploadPartUrlsRequest>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = CreateUploadPartUrlsRequest.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of CreateUploadPartUrlsRequest-objects as value to a dart map
  static Map<String, List<CreateUploadPartUrlsRequest>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<CreateUploadPartUrlsRequest>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = CreateUploadPartUrlsRequest.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

