//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class TimelineApi {
  TimelineApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// 送ったテキスト入力か画像・動画を消す(送った本人)
  ///
  /// 行は消さずに墓石(deleted)にし、本文・訳・URL を消す。2回目からは同じ墓石を返す(後始末はやり直す)。音声の発話と、他人の行は 403。消した後に、今ルームにいる人へデータチャネル(topic deletion、DeletionMessage)で知らせ、画像・動画なら S3 の本体とサムネイルを消して CloudFront のキャッシュを無効にする。これらが失敗しても墓石を 200 で返す。push 通知は取り消さない。
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] eventId (required):
  ///   履歴の行の event_id
  Future<Response> deleteTimelineEventWithHttpInfo(String roomId, String eventId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/timeline/event'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'event_id', eventId));

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// 送ったテキスト入力か画像・動画を消す(送った本人)
  ///
  /// 行は消さずに墓石(deleted)にし、本文・訳・URL を消す。2回目からは同じ墓石を返す(後始末はやり直す)。音声の発話と、他人の行は 403。消した後に、今ルームにいる人へデータチャネル(topic deletion、DeletionMessage)で知らせ、画像・動画なら S3 の本体とサムネイルを消して CloudFront のキャッシュを無効にする。これらが失敗しても墓石を 200 で返す。push 通知は取り消さない。
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] eventId (required):
  ///   履歴の行の event_id
  Future<TimelineEvent?> deleteTimelineEvent(String roomId, String eventId, { Future<void>? abortTrigger, }) async {
    final response = await deleteTimelineEventWithHttpInfo(roomId, eventId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'TimelineEvent',) as TimelineEvent;
    
    }
    return null;
  }

  /// 履歴の1件を取る(管理者かメンバー)。消した行は墓石(deleted)で返す
  ///
  /// 強い整合の読み取りなので、保存や削除の直後でも反映されている。アプリは、データチャネル(topic deletion)で届いた知らせを、これで確かめる。
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] eventId (required):
  ///   履歴の行の event_id
  Future<Response> getTimelineEventWithHttpInfo(String roomId, String eventId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/timeline/event'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

      queryParams.addAll(_queryParams('', 'event_id', eventId));

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// 履歴の1件を取る(管理者かメンバー)。消した行は墓石(deleted)で返す
  ///
  /// 強い整合の読み取りなので、保存や削除の直後でも反映されている。アプリは、データチャネル(topic deletion)で届いた知らせを、これで確かめる。
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] eventId (required):
  ///   履歴の行の event_id
  Future<TimelineEvent?> getTimelineEvent(String roomId, String eventId, { Future<void>? abortTrigger, }) async {
    final response = await getTimelineEventWithHttpInfo(roomId, eventId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'TimelineEvent',) as TimelineEvent;
    
    }
    return null;
  }

  /// ルームの履歴を新しい順に取る(管理者かメンバー)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [int] limit:
  ///   件数
  ///
  /// * [String] before:
  ///   この event_id より古いものを取る(前の応答の next_before)
  Future<Response> listTimelineWithHttpInfo(String roomId, { int? limit, String? before, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/timeline'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (limit != null) {
      queryParams.addAll(_queryParams('', 'limit', limit));
    }
    if (before != null) {
      queryParams.addAll(_queryParams('', 'before', before));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      path,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// ルームの履歴を新しい順に取る(管理者かメンバー)
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [int] limit:
  ///   件数
  ///
  /// * [String] before:
  ///   この event_id より古いものを取る(前の応答の next_before)
  Future<TimelinePage?> listTimeline(String roomId, { int? limit, String? before, Future<void>? abortTrigger, }) async {
    final response = await listTimelineWithHttpInfo(roomId, limit: limit, before: before, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'TimelinePage',) as TimelinePage;
    
    }
    return null;
  }

  /// 発話かテキスト入力を履歴に保存する(Agent)。同じ内容なら何度呼んでも同じ結果になる
  ///
  /// event_id は `<occurred_at>#<source_id>` で作る。同じ event_id があれば置き換える。ただし送った本人が消した行(墓石)は置き換えず、墓石を返す。
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] sourceId (required):
  ///   utterance では字幕の segment_id、text ではメッセージの ID
  ///
  /// * [PutTimelineEventRequest] putTimelineEventRequest (required):
  Future<Response> putTimelineEventWithHttpInfo(String roomId, String sourceId, PutTimelineEventRequest putTimelineEventRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/timeline/{source_id}'
      .replaceAll('{room_id}', roomId)
      .replaceAll('{source_id}', sourceId);

    // ignore: prefer_final_locals
    Object? postBody = putTimelineEventRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'PUT',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// 発話かテキスト入力を履歴に保存する(Agent)。同じ内容なら何度呼んでも同じ結果になる
  ///
  /// event_id は `<occurred_at>#<source_id>` で作る。同じ event_id があれば置き換える。ただし送った本人が消した行(墓石)は置き換えず、墓石を返す。
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] sourceId (required):
  ///   utterance では字幕の segment_id、text ではメッセージの ID
  ///
  /// * [PutTimelineEventRequest] putTimelineEventRequest (required):
  Future<TimelineEvent?> putTimelineEvent(String roomId, String sourceId, PutTimelineEventRequest putTimelineEventRequest, { Future<void>? abortTrigger, }) async {
    final response = await putTimelineEventWithHttpInfo(roomId, sourceId, putTimelineEventRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'TimelineEvent',) as TimelineEvent;
    
    }
    return null;
  }
}
