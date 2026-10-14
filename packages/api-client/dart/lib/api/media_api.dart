//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class MediaApi {
  MediaApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// アップロードした画像・動画を履歴に保存する(アップロードした本人)
  ///
  /// 本体(とサムネイル)が置かれていなければ 409。2回目からは、最初に保存した履歴を返す。保存した後に、今ルームにいる人へデータチャネル(topic media、MediaMessage)で配信し、最初の complete のときだけ、ルームにいないメンバーへ push 通知を送る。配信や通知に失敗しても、履歴を 200 で返す。2回目でも配信はやり直す。本文は要らない(画像・動画には文を添えられない)。前のクライアントが送る本文(text など)は無視する。
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] mediaId (required):
  ///   uploads が返した media_id
  Future<Response> completeMediaUploadWithHttpInfo(String roomId, String mediaId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/media/{media_id}/complete'
      .replaceAll('{room_id}', roomId)
      .replaceAll('{media_id}', mediaId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


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

  /// アップロードした画像・動画を履歴に保存する(アップロードした本人)
  ///
  /// 本体(とサムネイル)が置かれていなければ 409。2回目からは、最初に保存した履歴を返す。保存した後に、今ルームにいる人へデータチャネル(topic media、MediaMessage)で配信し、最初の complete のときだけ、ルームにいないメンバーへ push 通知を送る。配信や通知に失敗しても、履歴を 200 で返す。2回目でも配信はやり直す。本文は要らない(画像・動画には文を添えられない)。前のクライアントが送る本文(text など)は無視する。
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [String] mediaId (required):
  ///   uploads が返した media_id
  Future<TimelineEvent?> completeMediaUpload(String roomId, String mediaId, { Future<void>? abortTrigger, }) async {
    final response = await completeMediaUploadWithHttpInfo(roomId, mediaId, abortTrigger: abortTrigger,);
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

  /// 画像・動画をアップロードする署名付き URL を発行する(管理者かメンバー)
  ///
  /// PUT するときは Content-Type ヘッダーを content_type(サムネイルは image/jpeg)と同じにする。違うと S3 が 403 を返す。アップロードしたら complete を呼ぶ。width・height・duration_ms は、送信者が測った値をそのまま履歴に入れる(API は確かめない)。
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [CreateMediaUploadRequest] createMediaUploadRequest (required):
  Future<Response> createMediaUploadWithHttpInfo(String roomId, CreateMediaUploadRequest createMediaUploadRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}/media/uploads'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody = createMediaUploadRequest;

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

  /// 画像・動画をアップロードする署名付き URL を発行する(管理者かメンバー)
  ///
  /// PUT するときは Content-Type ヘッダーを content_type(サムネイルは image/jpeg)と同じにする。違うと S3 が 403 を返す。アップロードしたら complete を呼ぶ。width・height・duration_ms は、送信者が測った値をそのまま履歴に入れる(API は確かめない)。
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [CreateMediaUploadRequest] createMediaUploadRequest (required):
  Future<MediaUpload?> createMediaUpload(String roomId, CreateMediaUploadRequest createMediaUploadRequest, { Future<void>? abortTrigger, }) async {
    final response = await createMediaUploadWithHttpInfo(roomId, createMediaUploadRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MediaUpload',) as MediaUpload;
    
    }
    return null;
  }
}
