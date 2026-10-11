//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

library openapi.api;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:collection/collection.dart';
import 'package:http/http.dart';
import 'package:intl/intl.dart';
import 'package:meta/meta.dart';

part 'api_client.dart';
part 'api_helper.dart';
part 'api_exception.dart';
part 'auth/authentication.dart';
part 'auth/api_key_auth.dart';
part 'auth/oauth.dart';
part 'auth/http_basic_auth.dart';
part 'auth/http_bearer_auth.dart';

part 'api/health_api.dart';
part 'api/livekit_api.dart';
part 'api/media_api.dart';
part 'api/notifications_api.dart';
part 'api/rooms_api.dart';
part 'api/timeline_api.dart';
part 'api/users_api.dart';

part 'model/complete_media_upload_request.dart';
part 'model/create_media_upload_request.dart';
part 'model/create_room_request.dart';
part 'model/error_response.dart';
part 'model/http_validation_error.dart';
part 'model/health_response.dart';
part 'model/live_kit_token_request.dart';
part 'model/live_kit_token_response.dart';
part 'model/media_upload.dart';
part 'model/put_timeline_event_request.dart';
part 'model/put_user_request.dart';
part 'model/register_device_request.dart';
part 'model/response_validation_error.dart';
part 'model/room.dart';
part 'model/room_list.dart';
part 'model/speaking_notification_request.dart';
part 'model/speaking_notification_result.dart';
part 'model/timeline_event.dart';
part 'model/timeline_media.dart';
part 'model/timeline_page.dart';
part 'model/unregister_device_request.dart';
part 'model/update_room_request.dart';
part 'model/user.dart';
part 'model/user_list.dart';
part 'model/validation_error.dart';


/// An [ApiClient] instance that uses the default values obtained from
/// the OpenAPI specification file.
var defaultApiClient = ApiClient();

const _delimiters = {'csv': ',', 'ssv': ' ', 'tsv': '\t', 'pipes': '|'};
const _dateEpochMarker = 'epoch';
const _deepEquality = DeepCollectionEquality();
final _dateFormatter = DateFormat('yyyy-MM-dd');
final _regList = RegExp(r'^List<(.*)>$');
final _regSet = RegExp(r'^Set<(.*)>$');
final _regMap = RegExp(r'^Map<String,(.*)>$');

bool _isEpochMarker(String? pattern) => pattern == _dateEpochMarker || pattern == '/$_dateEpochMarker/';
