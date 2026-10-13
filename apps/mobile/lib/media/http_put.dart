import 'dart:async';

import 'package:http/http.dart' as http;

/// 署名付き URL への PUT が失敗した(S3 の応答が 2xx でない)。
class PutFailedException implements Exception {
  PutFailedException(this.statusCode, this.body);

  final int statusCode;
  final String body;

  @override
  String toString() => 'PUT が $statusCode で失敗した';
}

/// 署名付き URL に本体を PUT する。
///
/// - Content-Type は署名に含まれるので、uploads に渡した content_type と同じにする
///   (違うと S3 も SeaweedFS も 403。charset なども付けない)。
/// - 署名付きの PUT は chunked を受け付けないので、Content-Length を付ける。
/// - [onProgress] には、送り出したバイト数を渡す(実際に届いた量より少し先に進む)。
Future<void> putSigned(
  http.Client client,
  String url, {
  required Stream<List<int>> body,
  required int length,
  required String contentType,
  void Function(int sent)? onProgress,
}) async {
  final request = http.StreamedRequest('PUT', Uri.parse(url))
    ..contentLength = length
    ..headers['Content-Type'] = contentType;
  var sent = 0;
  final pumping = () async {
    try {
      await for (final chunk in body) {
        request.sink.add(chunk);
        sent += chunk.length;
        onProgress?.call(sent);
      }
    } catch (e, st) {
      request.sink.addError(e, st);
    } finally {
      await request.sink.close();
    }
  }();
  final response = await client.send(request);
  await pumping;
  final text = await response.stream.bytesToString();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw PutFailedException(response.statusCode, text);
  }
}
