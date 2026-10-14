// ローカルの環境(API、模擬 OIDC、LiveKit、SeaweedFS)につないで、画像を送り、ルームの表示と
// 履歴に出るまでを通す。README の「統合テスト」を参照。
//
// image_picker の画面は操作できないので、作った JPEG を RoomScreenState.uploader に直接渡す
// (整える → uploads → 本体とサムネイルの PUT → complete は本物を通る)。
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';
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
}
