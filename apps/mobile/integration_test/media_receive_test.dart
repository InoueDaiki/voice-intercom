// ローカルの環境(API、模擬 OIDC、LiveKit、SeaweedFS)につないで、別の参加者が送った画像が
// ルームの表示に出るまでを通す。README の「統合テスト」を参照。
//
// 入室した後に、相手役(TEST_PEER、既定は bob)として API を直接呼び、画像を送る
// (uploads → PUT → complete。アプリの MediaUploader を相手役のトークンで使う)。
// complete の後に API が topic `media` で配信し、アプリは履歴で確かめてから表示する。
// 相手役は LiveKit のルームに入らない。ルームのメンバーにいなければ、管理者のトークンで足す。
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:integration_test/integration_test.dart';
import 'package:voice_intercom/api.dart';
import 'package:voice_intercom/config.dart';
import 'package:voice_intercom/media/api_media_backend.dart';
import 'package:voice_intercom/media/media_uploader.dart';
import 'package:voice_intercom/screens/media_viewer_screen.dart';
import 'package:voice_intercom/screens/room_screen.dart';
import 'package:voice_intercom_api_client/api.dart' as client;

import 'helpers.dart';

const testPeer = String.fromEnvironment('TEST_PEER', defaultValue: 'bob');

/// 相手役をルームのメンバーにする(管理者のトークンで)
Future<void> ensureMember(String roomName, String user) async {
  final admin = MockOidcAuth(user: 'integration-admin', groups: ['admin']);
  await admin.restore();
  final c = client.ApiClient(
    basePath: AppConfig.apiBaseUrl,
    authentication: client.HttpBearerAuth()
      ..accessToken = await admin.accessToken(),
  );
  final rooms = await client.RoomsApi(c).listRooms();
  final room = rooms!.items.firstWhere((r) => r.name == roomName);
  if (!room.memberIds.contains(user)) {
    await client.RoomsApi(c).updateRoom(
      room.roomId,
      client.UpdateRoomRequest(memberIds: [...room.memberIds, user]),
    );
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('別の参加者が送った画像が、ルームの表示に出る', (tester) async {
    await ensureMember(testRoomName, testPeer);
    final state = await enterRoom(tester);
    final room = tester.state<RoomScreenState>(find.byType(RoomScreen));
    final roomId = (await state.api.listRooms())
        .firstWhere((r) => r.name == testRoomName)
        .roomId;

    // 相手役。プロフィールは push 通知の本文にだけ使うので、無くても送れる
    final peerAuth = MockOidcAuth(user: testPeer);
    await peerAuth.restore();
    final peerApi = Api(peerAuth);
    final backend = ApiMediaBackend(peerApi);
    client.TimelineEvent? sent;
    final uploader = MediaUploader(
      roomId: roomId,
      backend: backend,
      onChanged: () {},
      onCompleted: (e) => sent = e,
    );

    final image = img.Image(width: 64, height: 48);
    for (final p in image) {
      p
        ..r = 200
        ..g = 80
        ..b = 40;
    }
    final file = File(
      '${Directory.systemTemp.path}/media_receive_test_${DateTime.now().millisecondsSinceEpoch}.jpg',
    )..writeAsBytesSync(img.encodeJpg(image));
    final caption = '受信の統合テスト ${DateTime.now().toIso8601String()}';

    final item = uploader.submit(file.path, text: caption);
    await pumpUntil(
      tester,
      () => !item.active,
      timeout: const Duration(seconds: 60),
      reason: '相手役の送信',
    );
    expect(item.error, isNull);
    final event = sent!;

    // 配信で届き、履歴で確かめて出る(アプリは入り直しも、履歴の読み直しもしていない)
    await pumpUntil(
      tester,
      () => shows(find.text(caption)),
      timeout: const Duration(seconds: 15),
      reason: '配信で届いた画像がルームの表示に出る',
    );
    expect(room.uploader.items, isEmpty, reason: '自分の送信ではない');
    final shown = room.session.media.items
        .where((e) => e.eventId == event.eventId)
        .toList();
    expect(shown, hasLength(1));
    expect(shown.single.senderId, testPeer);
    expect(shown.single.media!.url, event.media!.url);
    // 相手役は LiveKit のルームにいないので、表示名は identity のまま
    expect(find.textContaining('$testPeer(画像)'), findsOneWidget);

    // complete のやり直しで2回目が届いても、重ならない
    await backend.complete(
      roomId,
      event.media!.mediaId,
      client.CompleteMediaUploadRequest(text: caption),
    );
    await tester.pump(const Duration(seconds: 3));
    expect(find.text(caption), findsOneWidget);

    // タップで全画面に開く
    await tester.tap(find.byKey(Key('media-${event.media!.mediaId}')));
    await pumpUntil(
      tester,
      () => shows(find.byType(MediaViewerScreen)),
      reason: '全画面の表示',
    );
    await tester.pump(const Duration(seconds: 3));
    expect(find.text('画像を読めなかった'), findsNothing);

    uploader.dispose();
    backend.close();
    file.deleteSync();
  });
}
