// ローカルの環境(API、模擬 OIDC、LiveKit、SeaweedFS)につないで、画像を送り、ルームの表示と
// 履歴に出るまでを通す。README の「統合テスト」を参照。
//
// image_picker の画面は操作できないので、作った JPEG を RoomScreenState.uploader に直接渡す
// (整える → uploads → 本体とサムネイルの PUT → complete は本物を通る)。
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';
import 'package:voice_intercom/media/media_uploader.dart';
import 'package:voice_intercom/screens/media_viewer_screen.dart';
import 'package:voice_intercom/screens/timeline_screen.dart';
import 'package:voice_intercom/screens/room_screen.dart';

import 'helpers.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('画像を送り、ルームの表示と履歴に出る', (tester) async {
    await enterRoom(tester);
    final room = tester.state<RoomScreenState>(find.byType(RoomScreen));

    // 1MB を超える JPEG(サムネイルも作って上げる)
    final random = Random(1);
    final image = img.Image(width: 1600, height: 1200);
    for (final p in image) {
      p
        ..r = random.nextInt(256)
        ..g = random.nextInt(256)
        ..b = random.nextInt(256);
    }
    final file = File(
      '${Directory.systemTemp.path}/media_upload_test_${DateTime.now().millisecondsSinceEpoch}.jpg',
    )..writeAsBytesSync(img.encodeJpg(image, quality: 95));
    final item = room.uploader.submit(file.path);
    // 画像・動画には文を添えられないので、表示は media_id のキーで探す
    Finder card() => find.byKey(Key('media-${item.event?.media?.mediaId}'));
    await pumpUntil(
      tester,
      () => !item.active && shows(card()),
      timeout: const Duration(seconds: 60),
      reason: 'complete の応答でルームの表示に出る',
    );
    expect(item.error, isNull);
    final media = item.event!.media!;
    expect(media.thumbnailUrl, isNotNull);
    // 整えた後の本体で測った幅・高さが履歴に入る。画像に長さは無い
    expect((media.width, media.height), (1600, 1200));
    expect(media.durationMs, isNull);

    // タップで全画面に開く
    await tester.tap(find.byKey(Key('media-${media.mediaId}')));
    await pumpUntil(
      tester,
      () => shows(find.byType(MediaViewerScreen)),
      reason: '全画面の表示',
    );
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('画像を読めなかった'), findsNothing);
    await tester.pageBack();
    await pumpUntil(
      tester,
      () => !shows(find.byType(MediaViewerScreen)),
      reason: 'ルームに戻る',
    );

    // 履歴にも出る
    await tester.tap(find.byIcon(Icons.history));
    await pumpUntil(
      tester,
      () => shows(find.byType(TimelineScreen)) && shows(card()),
      reason: '履歴',
    );
    file.deleteSync();
  });

  testWidgets('16MB 以上の画像はマルチパートで送り、そのまま読める', (tester) async {
    await enterRoom(tester);
    final room = tester.state<RoomScreenState>(find.byType(RoomScreen));

    // 約 40MB の JPEG。中身は小さな画像で、APP15 のセグメント(読み手は飛ばす)で膨らませる。
    // 形式の見分けとデコード(幅・高さ、サムネイル)はそのまま通る。8MB のパートで6つになる
    final bytes = bigJpeg(40 * 1024 * 1024 + 123);
    final file = File(
      '${Directory.systemTemp.path}/media_upload_multipart_${DateTime.now().millisecondsSinceEpoch}.jpg',
    )..writeAsBytesSync(bytes);
    final progress = <double>[];
    final item = room.uploader.submit(file.path);
    await pumpUntil(
      tester,
      () {
        final p = item.progress;
        if (item.state == OutgoingMediaState.uploading && p != null) {
          progress.add(p);
        }
        return !item.active;
      },
      timeout: const Duration(minutes: 3),
      reason: 'マルチパートで送り終える',
    );
    expect(item.error, isNull);
    expect(item.ticket!.multipart!.partCount, 6);
    expect(item.partEtags.length, 6);
    // 進み具合は全パートの合計で、途中の値も出る
    expect(progress.where((p) => p > 0 && p < 1), isNotEmpty);
    final media = item.event!.media!;
    expect(media.sizeBytes, bytes.length);
    expect((media.width, media.height), (320, 240));
    expect(media.thumbnailUrl, isNotNull);
    await pumpUntil(
      tester,
      () => shows(find.byKey(Key('media-${media.mediaId}'))),
      reason: 'complete の応答でルームの表示に出る',
    );

    // 置かれた本体が、送ったファイルと同じ(パートの順と境目が合っている)
    final res = await http.get(Uri.parse(media.url));
    expect(res.statusCode, 200);
    expect(res.headers['content-type'], 'image/jpeg');
    expect(res.bodyBytes.length, bytes.length);
    expect(listEquals(res.bodyBytes, bytes), isTrue);
    file.deleteSync();
  });
}

/// [size] バイトちょうどの JPEG(320x240)。SOI の直後に APP15 のセグメントを並べて膨らませる
Uint8List bigJpeg(int size) {
  final random = Random(2);
  final image = img.Image(width: 320, height: 240);
  for (final p in image) {
    p
      ..r = random.nextInt(256)
      ..g = random.nextInt(256)
      ..b = random.nextInt(256);
  }
  final jpeg = img.encodeJpg(image, quality: 90);
  final out = BytesBuilder(copy: false)..add(jpeg.sublist(0, 2));
  var left = size - jpeg.length;
  while (left > 0) {
    // セグメントは長さの欄(2バイト)を含めて 65535 バイトまで。マーカーの2バイトも数える
    var segment = min(left, 65535 + 2);
    if (left - segment > 0 && left - segment < 4) {
      // 残りが小さすぎてセグメントにできないので、今のを少し短くする
      segment -= 4;
    }
    final payload = segment - 4;
    out
      ..add([0xFF, 0xEF, (payload + 2) >> 8, (payload + 2) & 0xFF])
      ..add(Uint8List(payload)..fillRange(0, payload, random.nextInt(256)));
    left -= segment;
  }
  out.add(jpeg.sublist(2));
  final result = out.takeBytes();
  assert(result.length == size);
  return result;
}
