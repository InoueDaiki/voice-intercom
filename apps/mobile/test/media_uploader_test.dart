import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/media/media_preparer.dart';
import 'package:voice_intercom/media/media_uploader.dart';
import 'package:voice_intercom_api_client/api.dart';

import 'support/media_fixtures.dart';

class FakePreparer implements MediaPreparer {
  int calls = 0;
  Object? error;
  bool video = false;
  Uint8List? thumbnail = Uint8List.fromList([0xFF, 0xD8, 0xFF]);

  @override
  Future<PreparedMedia> prepare(
    String path, {
    void Function(double progress)? onProgress,
  }) async {
    calls++;
    onProgress?.call(0.5);
    final e = error;
    if (e != null) {
      throw e;
    }
    return PreparedMedia(
      path: '$path.out',
      contentType: video ? 'video/mp4' : 'image/jpeg',
      sizeBytes: 100,
      isVideo: video,
      thumbnail: thumbnail,
      size: video ? (width: 720, height: 1280) : (width: 1600, height: 1200),
      durationMs: video ? 15500 : null,
    );
  }
}

class FakeBackend implements MediaUploadBackend {
  final calls = <String>[];
  final requests = <CreateMediaUploadRequest>[];
  final failures = <String, Object>{};
  String expiresAt = '2026-10-13T01:00:00.000Z';
  int _tickets = 0;

  void _maybeFail(String name) {
    final e = failures.remove(name);
    if (e != null) {
      throw e;
    }
  }

  @override
  Future<MediaUpload> createUpload(
    String roomId,
    CreateMediaUploadRequest request,
  ) async {
    calls.add('uploads');
    requests.add(request);
    _maybeFail('uploads');
    final id = 'media${++_tickets}';
    return MediaUpload(
      mediaId: id,
      uploadUrl: 'https://s3.example/$id/original',
      thumbnailUploadUrl: request.hasThumbnail
          ? 'https://s3.example/$id/thumbnail'
          : null,
      expiresAt: expiresAt,
    );
  }

  @override
  Future<void> putFile(
    String url,
    String path,
    int length,
    String contentType, {
    void Function(int sent)? onProgress,
  }) async {
    calls.add('put $url $contentType');
    onProgress?.call(length);
    _maybeFail('put');
  }

  @override
  Future<void> putBytes(String url, Uint8List bytes, String contentType) async {
    calls.add('put $url $contentType');
    _maybeFail('thumbnail');
  }

  @override
  Future<TimelineEvent> complete(String roomId, String mediaId) async {
    calls.add('complete $mediaId');
    _maybeFail('complete');
    return mediaEvent('2026-10-13T00:00:00.000Z', sourceId: mediaId);
  }
}

void main() {
  late FakeBackend backend;
  late FakePreparer preparer;
  late List<TimelineEvent> completed;
  late MediaUploader uploader;
  var now = DateTime.utc(2026, 10, 13);

  setUp(() {
    backend = FakeBackend();
    preparer = FakePreparer();
    completed = [];
    now = DateTime.utc(2026, 10, 13);
    uploader = MediaUploader(
      roomId: 'r1',
      backend: backend,
      preparer: preparer,
      onChanged: () {},
      onCompleted: completed.add,
      now: () => now,
    );
  });

  /// 順番待ちの処理が終わるまで待つ
  Future<void> settle() => pumpEventQueue();

  test('整える → uploads → 本体とサムネイルの PUT → complete', () async {
    final item = uploader.submit('/tmp/a.jpg');
    expect(item.state, OutgoingMediaState.preparing);
    await settle();

    expect(backend.calls, [
      'uploads',
      'put https://s3.example/media1/original image/jpeg',
      'put https://s3.example/media1/thumbnail image/jpeg',
      'complete media1',
    ]);
    final request = backend.requests.single;
    expect(
      request.contentType,
      CreateMediaUploadRequestContentTypeEnum.imageSlashJpeg,
    );
    expect(request.sizeBytes, 100);
    expect(request.hasThumbnail, isTrue);
    // 整えた後の本体で測った幅・高さ。画像に長さは無い
    expect((request.width, request.height), (1600, 1200));
    expect(request.durationMs, isNull);
    expect(item.state, OutgoingMediaState.done);
    expect(completed.single.media!.mediaId, 'media1');
    // 済んだものは送信中の一覧から外れる
    expect(uploader.items, isEmpty);
  });

  test('サムネイルが無ければ has_thumbnail を false にし、PUT しない', () async {
    preparer.thumbnail = null;
    uploader.submit('/tmp/a.png');
    await settle();
    expect(backend.requests.single.hasThumbnail, isFalse);
    expect(backend.calls.where((c) => c.contains('thumbnail')), isEmpty);
  });

  test('動画は video/mp4 で上げる', () async {
    preparer.video = true;
    final item = uploader.submit('/tmp/a.mov');
    await settle();
    expect(
      backend.requests.single.contentType,
      CreateMediaUploadRequestContentTypeEnum.videoSlashMp4,
    );
    expect(item.isVideo, isTrue);
    final request = backend.requests.single;
    expect((request.width, request.height), (720, 1280));
    expect(request.durationMs, 15500);
  });

  test('本体の PUT が失敗したら、同じ署名付き URL で PUT からやり直す', () async {
    backend.failures['put'] = StateError('回線が切れた');
    final item = uploader.submit('/tmp/a.jpg');
    await settle();
    expect(item.state, OutgoingMediaState.failed);
    expect(item.retryable, isTrue);
    expect(item.error, startsWith('アップロードできなかった'));
    expect(uploader.items, [item]);

    backend.calls.clear();
    uploader.retry(item);
    await settle();
    expect(backend.calls, [
      'put https://s3.example/media1/original image/jpeg',
      'put https://s3.example/media1/thumbnail image/jpeg',
      'complete media1',
    ]);
    expect(preparer.calls, 1);
    expect(item.state, OutgoingMediaState.done);
  });

  test('complete が失敗したら、complete だけやり直す', () async {
    backend.failures['complete'] = ApiException(503, 'Service Unavailable');
    final item = uploader.submit('/tmp/a.jpg');
    await settle();
    expect(item.state, OutgoingMediaState.failed);
    expect(item.error, '保存できなかった(503)');

    backend.calls.clear();
    uploader.retry(item);
    await settle();
    expect(backend.calls, ['complete media1']);
    expect(item.state, OutgoingMediaState.done);
  });

  test('complete が 409(本体が置かれていない)なら、PUT からやり直す', () async {
    backend.failures['complete'] = ApiException(409, 'not uploaded');
    final item = uploader.submit('/tmp/a.jpg');
    await settle();

    backend.calls.clear();
    uploader.retry(item);
    await settle();
    expect(backend.calls, [
      'put https://s3.example/media1/original image/jpeg',
      'put https://s3.example/media1/thumbnail image/jpeg',
      'complete media1',
    ]);
  });

  test('サムネイルの PUT だけ失敗したら、本体は上げ直さない', () async {
    backend.failures['thumbnail'] = StateError('403');
    final item = uploader.submit('/tmp/a.jpg');
    await settle();

    backend.calls.clear();
    uploader.retry(item);
    await settle();
    expect(backend.calls, [
      'put https://s3.example/media1/thumbnail image/jpeg',
      'complete media1',
    ]);
  });

  test('署名付き URL の期限が近ければ、uploads から取り直す', () async {
    backend.failures['put'] = StateError('回線が切れた');
    final item = uploader.submit('/tmp/a.jpg');
    await settle();

    // 期限(01:00)の5分前を過ぎた
    now = DateTime.utc(2026, 10, 13, 0, 56);
    backend.calls.clear();
    uploader.retry(item);
    await settle();
    expect(backend.calls.first, 'uploads');
    expect(backend.calls.last, 'complete media2');
  });

  test('uploads が失敗したら uploads からやり直す', () async {
    backend.failures['uploads'] = ApiException(500, 'boom');
    final item = uploader.submit('/tmp/a.jpg');
    await settle();
    expect(item.error, 'アップロードできなかった(500)');

    backend.calls.clear();
    uploader.retry(item);
    await settle();
    expect(backend.calls.first, 'uploads');
    expect(item.state, OutgoingMediaState.done);
  });

  test('圧縮の失敗はやり直せる。整え直す', () async {
    preparer.error = StateError('動画を圧縮できなかった');
    final item = uploader.submit('/tmp/a.mov');
    await settle();
    expect(item.state, OutgoingMediaState.failed);
    expect(item.error, startsWith('圧縮できなかった'));
    expect(backend.calls, isEmpty);

    preparer.error = null;
    uploader.retry(item);
    expect(item.state, OutgoingMediaState.preparing);
    await settle();
    expect(preparer.calls, 2);
    expect(item.state, OutgoingMediaState.done);
  });

  test('送れない形式・大きさはやり直させない', () async {
    preparer.error = UnsupportedMediaException('動画は3分までにする');
    final item = uploader.submit('/tmp/long.mov');
    await settle();
    expect(item.state, OutgoingMediaState.failed);
    expect(item.retryable, isFalse);
    expect(item.error, '動画は3分までにする');

    uploader.retry(item);
    await settle();
    expect(preparer.calls, 1);

    uploader.dismiss(item);
    expect(uploader.items, isEmpty);
  });

  test('1つずつ順に送る', () async {
    uploader.submit('/tmp/a.jpg');
    uploader.submit('/tmp/b.jpg');
    await settle();
    expect(
      backend.calls.where((c) => c == 'uploads' || c.startsWith('complete')),
      ['uploads', 'complete media1', 'uploads', 'complete media2'],
    );
    expect(completed.map((e) => e.media!.mediaId), ['media1', 'media2']);
  });

  test('送信中のものは取りやめられない', () async {
    final item = uploader.submit('/tmp/a.jpg');
    uploader.dismiss(item);
    expect(uploader.items, [item]);
    await settle();
  });
}
