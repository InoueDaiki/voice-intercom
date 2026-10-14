import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:voice_intercom_api_client/api.dart';

import '../api.dart';
import 'http_put.dart';
import 'media_uploader.dart';

/// [MediaUploader] の送り先。uploads と complete は API、PUT は署名付き URL(S3)。
class ApiMediaBackend implements MediaUploadBackend {
  ApiMediaBackend(this._api, {http.Client? client})
    : _client = client ?? http.Client();

  final Api _api;

  // 署名付き URL には API のアクセストークンを付けない(別の client を使う)
  final http.Client _client;

  @override
  Future<MediaUpload> createUpload(
    String roomId,
    CreateMediaUploadRequest request,
  ) => _api.createMediaUpload(roomId, request);

  @override
  Future<void> putFile(
    String url,
    String path,
    int length,
    String contentType, {
    void Function(int sent)? onProgress,
  }) => putSigned(
    _client,
    url,
    body: File(path).openRead(),
    length: length,
    contentType: contentType,
    onProgress: onProgress,
  );

  @override
  Future<void> putBytes(String url, Uint8List bytes, String contentType) =>
      putSigned(
        _client,
        url,
        body: Stream.value(bytes),
        length: bytes.length,
        contentType: contentType,
      );

  @override
  Future<TimelineEvent> complete(String roomId, String mediaId) =>
      _api.completeMediaUpload(roomId, mediaId);

  void close() => _client.close();
}
