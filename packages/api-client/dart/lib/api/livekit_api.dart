//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class LivekitApi {
  LivekitApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// LiveKit の参加用トークンを発行する
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [LiveKitTokenRequest] liveKitTokenRequest (required):
  Future<Response> createLiveKitTokenWithHttpInfo(LiveKitTokenRequest liveKitTokenRequest, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final path = r'/livekit/token';

    // ignore: prefer_final_locals
    Object? postBody = liveKitTokenRequest;

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

  /// LiveKit の参加用トークンを発行する
  ///
  /// Parameters:
  ///
  /// * [LiveKitTokenRequest] liveKitTokenRequest (required):
  Future<void> createLiveKitToken(LiveKitTokenRequest liveKitTokenRequest, { Future<void>? abortTrigger, }) async {
    final response = await createLiveKitTokenWithHttpInfo(liveKitTokenRequest, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }
}
