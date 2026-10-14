//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class NotificationsApi {
  NotificationsApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// 誰かが話し始めたことを、ルームにいないメンバーに push 通知する(Agent)
  ///
  /// ルームのメンバーから、話者と present_ids を除いた人に送る。同じルーム × 同じ受け手には、間隔(既定 300 秒。テキスト・画像・動画の通知と共通)に1回まで。送信に失敗しても 500 にはせず、sent を 0 にして返す。
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [SpeakingNotificationRequest] speakingNotificationRequest (required):
  Future<Response> notifySpeakingWithHttpInfo(String roomId, SpeakingNotificationRequest speakingNotificationRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/notifications/speaking'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody = speakingNotificationRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// 誰かが話し始めたことを、ルームにいないメンバーに push 通知する(Agent)
  ///
  /// ルームのメンバーから、話者と present_ids を除いた人に送る。同じルーム × 同じ受け手には、間隔(既定 300 秒。テキスト・画像・動画の通知と共通)に1回まで。送信に失敗しても 500 にはせず、sent を 0 にして返す。
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [SpeakingNotificationRequest] speakingNotificationRequest (required):
  Future<NotificationResult?> notifySpeaking(String roomId, SpeakingNotificationRequest speakingNotificationRequest, { Future<void>? abortTrigger, }) async {
    final response = await notifySpeakingWithHttpInfo(roomId, speakingNotificationRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'NotificationResult',) as NotificationResult;
    
    }
    return null;
  }

  /// テキスト入力が届いたことを、ルームにいないメンバーに push 通知する(Agent)
  ///
  /// ルームのメンバーから、送信者と present_ids を除いた人に送る。本文は「<表示名>さん: <テキストの先頭>」。同じルーム × 同じ受け手には、間隔(既定 300 秒。話し始め・画像・動画の通知と共通)に1回まで。送信に失敗しても 500 にはせず、sent を 0 にして返す。
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [TextNotificationRequest] textNotificationRequest (required):
  Future<Response> notifyTextWithHttpInfo(String roomId, TextNotificationRequest textNotificationRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/notifications/text'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody = textNotificationRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// テキスト入力が届いたことを、ルームにいないメンバーに push 通知する(Agent)
  ///
  /// ルームのメンバーから、送信者と present_ids を除いた人に送る。本文は「<表示名>さん: <テキストの先頭>」。同じルーム × 同じ受け手には、間隔(既定 300 秒。話し始め・画像・動画の通知と共通)に1回まで。送信に失敗しても 500 にはせず、sent を 0 にして返す。
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [TextNotificationRequest] textNotificationRequest (required):
  Future<NotificationResult?> notifyText(String roomId, TextNotificationRequest textNotificationRequest, { Future<void>? abortTrigger, }) async {
    final response = await notifyTextWithHttpInfo(roomId, textNotificationRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'NotificationResult',) as NotificationResult;
    
    }
    return null;
  }
}
