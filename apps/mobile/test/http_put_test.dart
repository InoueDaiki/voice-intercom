import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_intercom/media/http_put.dart';

void main() {
  test('Content-Type を署名と同じにし、Content-Length を付けて PUT する', () async {
    late http.BaseRequest seen;
    late List<int> body;
    final client = MockClient.streaming((request, bodyStream) async {
      seen = request;
      body = await bodyStream.expand((c) => c).toList();
      return http.StreamedResponse(const Stream.empty(), 200);
    });
    final progress = <int>[];
    await putSigned(
      client,
      'https://s3.example/rooms/r1/m1/original?X-Amz-Signature=abc',
      body: Stream.fromIterable([
        [1, 2, 3],
        [4, 5],
      ]),
      length: 5,
      contentType: 'video/mp4',
      onProgress: progress.add,
    );
    expect(seen.method, 'PUT');
    expect(seen.url.queryParameters['X-Amz-Signature'], 'abc');
    // charset などを足すと署名が合わず 403 になる
    expect(seen.headers['Content-Type'], 'video/mp4');
    expect(seen.contentLength, 5);
    expect(body, [1, 2, 3, 4, 5]);
    expect(progress, [3, 5]);
  });

  test('2xx でなければ PutFailedException', () async {
    final client = MockClient.streaming((request, bodyStream) async {
      await bodyStream.drain<void>();
      return http.StreamedResponse(
        Stream.value('SignatureDoesNotMatch'.codeUnits),
        403,
      );
    });
    await expectLater(
      putSigned(
        client,
        'https://s3.example/x',
        body: Stream.value([1]),
        length: 1,
        contentType: 'image/jpeg',
      ),
      throwsA(
        isA<PutFailedException>()
            .having((e) => e.statusCode, 'statusCode', 403)
            .having((e) => e.body, 'body', 'SignatureDoesNotMatch'),
      ),
    );
  });
}
