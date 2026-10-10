//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class UsersApi {
  UsersApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// 自分のプロフィールを取る
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getMyProfileWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/users/me';

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

  /// 自分のプロフィールを取る
  Future<User?> getMyProfile({ Future<void>? abortTrigger, }) async {
    final response = await getMyProfileWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'User',) as User;
    
    }
    return null;
  }

  /// ユーザーの一覧(管理者)。プロフィールを登録した人だけを返す
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> listUsersWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/users';

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

  /// ユーザーの一覧(管理者)。プロフィールを登録した人だけを返す
  Future<UserList?> listUsers({ Future<void>? abortTrigger, }) async {
    final response = await listUsersWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'UserList',) as UserList;
    
    }
    return null;
  }

  /// 自分のプロフィールを登録・更新する
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [PutUserRequest] putUserRequest (required):
  Future<Response> putMyProfileWithHttpInfo(PutUserRequest putUserRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/users/me';

    // ignore: prefer_final_locals
    Object? postBody = putUserRequest;

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

  /// 自分のプロフィールを登録・更新する
  ///
  /// Parameters:
  ///
  /// * [PutUserRequest] putUserRequest (required):
  Future<User?> putMyProfile(PutUserRequest putUserRequest, { Future<void>? abortTrigger, }) async {
    final response = await putMyProfileWithHttpInfo(putUserRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'User',) as User;
    
    }
    return null;
  }

  /// 自分の端末トークンを登録する。アプリの起動時とトークンの更新時に呼ぶ。1人 10 台までで、超えたら最後の登録がいちばん古い端末を外す。同じトークンを別の人が登録していたら、その人から外す
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [RegisterDeviceRequest] registerDeviceRequest (required):
  Future<Response> registerMyDeviceWithHttpInfo(RegisterDeviceRequest registerDeviceRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/users/me/devices';

    // ignore: prefer_final_locals
    Object? postBody = registerDeviceRequest;

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

  /// 自分の端末トークンを登録する。アプリの起動時とトークンの更新時に呼ぶ。1人 10 台までで、超えたら最後の登録がいちばん古い端末を外す。同じトークンを別の人が登録していたら、その人から外す
  ///
  /// Parameters:
  ///
  /// * [RegisterDeviceRequest] registerDeviceRequest (required):
  Future<void> registerMyDevice(RegisterDeviceRequest registerDeviceRequest, { Future<void>? abortTrigger, }) async {
    final response = await registerMyDeviceWithHttpInfo(registerDeviceRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// 自分の端末トークンを外す(ログアウトのとき)。登録されていなくても 204
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [UnregisterDeviceRequest] unregisterDeviceRequest (required):
  Future<Response> unregisterMyDeviceWithHttpInfo(UnregisterDeviceRequest unregisterDeviceRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/users/me/devices';

    // ignore: prefer_final_locals
    Object? postBody = unregisterDeviceRequest;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


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

  /// 自分の端末トークンを外す(ログアウトのとき)。登録されていなくても 204
  ///
  /// Parameters:
  ///
  /// * [UnregisterDeviceRequest] unregisterDeviceRequest (required):
  Future<void> unregisterMyDevice(UnregisterDeviceRequest unregisterDeviceRequest, { Future<void>? abortTrigger, }) async {
    final response = await unregisterMyDeviceWithHttpInfo(unregisterDeviceRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
