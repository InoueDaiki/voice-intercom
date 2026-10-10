//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class RoomsApi {
  RoomsApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// ルームを作る(管理者)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [CreateRoomRequest] createRoomRequest (required):
  Future<Response> createRoomWithHttpInfo(CreateRoomRequest createRoomRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms';

    // ignore: prefer_final_locals
    Object? postBody = createRoomRequest;

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

  /// ルームを作る(管理者)
  ///
  /// Parameters:
  ///
  /// * [CreateRoomRequest] createRoomRequest (required):
  Future<Room?> createRoom(CreateRoomRequest createRoomRequest, { Future<void>? abortTrigger, }) async {
    final response = await createRoomWithHttpInfo(createRoomRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'Room',) as Room;
    
    }
    return null;
  }

  /// ルームを消す(管理者)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  Future<Response> deleteRoomWithHttpInfo(String roomId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// ルームを消す(管理者)
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  Future<void> deleteRoom(String roomId, { Future<void>? abortTrigger, }) async {
    final response = await deleteRoomWithHttpInfo(roomId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// ルームを取る(管理者かメンバー)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  Future<Response> getRoomWithHttpInfo(String roomId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// ルームを取る(管理者かメンバー)
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  Future<Room?> getRoom(String roomId, { Future<void>? abortTrigger, }) async {
    final response = await getRoomWithHttpInfo(roomId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'Room',) as Room;
    
    }
    return null;
  }

  /// ルームの一覧。管理者にはすべて、それ以外の人には自分がメンバーのルームを返す
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> listRoomsWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

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

  /// ルームの一覧。管理者にはすべて、それ以外の人には自分がメンバーのルームを返す
  Future<RoomList?> listRooms({ Future<void>? abortTrigger, }) async {
    final response = await listRoomsWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'RoomList',) as RoomList;
    
    }
    return null;
  }

  /// ルームの名前とメンバーを変える(管理者)
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [UpdateRoomRequest] updateRoomRequest (required):
  Future<Response> updateRoomWithHttpInfo(String roomId, UpdateRoomRequest updateRoomRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/rooms/{room_id}'
      .replaceAll('{room_id}', roomId);

    // ignore: prefer_final_locals
    Object? postBody = updateRoomRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      path,
      'PATCH',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// ルームの名前とメンバーを変える(管理者)
  ///
  /// Parameters:
  ///
  /// * [String] roomId (required):
  ///   ルームの ID
  ///
  /// * [UpdateRoomRequest] updateRoomRequest (required):
  Future<Room?> updateRoom(String roomId, UpdateRoomRequest updateRoomRequest, { Future<void>? abortTrigger, }) async {
    final response = await updateRoomWithHttpInfo(roomId, updateRoomRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'Room',) as Room;
    
    }
    return null;
  }
}
