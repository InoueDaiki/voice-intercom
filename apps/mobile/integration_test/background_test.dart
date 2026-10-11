// 入室したままホームに戻っても、別の参加者の字幕と音声が届き続けるかを確かめる
// (設計メモの「バックグラウンドでの音声」)。README の「統合テスト」を参照。
//
// ホームに戻す・前面に戻すのはホストの send_home_when_joined.sh が行う(adb)。テストは
// ログの「BG_TEST:」で合図する。裏にいる間は画面が描かれないので、pump せずに接続の状態を見る。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:voice_intercom/room/caption_board.dart';
import 'package:voice_intercom/screens/room_screen.dart';
import 'package:voice_intercom/screens/rooms_screen.dart';

import 'helpers.dart';

/// 画面を描かずに(裏にいても)待つ
Future<void> waitUntil(
  bool Function() done, {
  required Duration timeout,
  required String reason,
}) async {
  final end = DateTime.now().add(timeout);
  while (!done()) {
    if (DateTime.now().isAfter(end)) {
      fail('待ちきれなかった: $reason');
    }
    await Future<void>.delayed(const Duration(milliseconds: 200));
  }
}

AppLifecycleState? get _lifecycle => WidgetsBinding.instance.lifecycleState;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('入室したまま裏に回っても、字幕と音声が届き続け、退室で止まる', (tester) async {
    await enterRoom(tester);
    final session = tester
        .state<RoomScreenState>(find.byType(RoomScreen))
        .session;

    // 1. ホームに戻す(相手役は入室の10秒後に話し始める)
    debugPrint('BG_TEST: joined');
    await waitUntil(
      () => _lifecycle == AppLifecycleState.paused,
      timeout: const Duration(seconds: 30),
      reason: '裏に回る(send_home_when_joined.sh)',
    );

    // 2. 裏にいる間に、英語の話者の原文と日本語の訳が確定まで届く
    bool received(CaptionSegment s) =>
        s.originalLanguage == 'en' &&
        (s.original?.isFinal ?? false) &&
        (s.translations['ja']?.isFinal ?? false);
    await waitUntil(
      () => session.captions.segments.any(received),
      timeout: const Duration(seconds: 120),
      reason: '裏にいる間の英語の話者の字幕(speak_when_joined.sh)',
    );
    expect(_lifecycle, AppLifecycleState.paused, reason: '届いたときに裏にいた');
    expect(session.connected, isTrue);
    final caption = session.captions.segments.firstWhere(received);
    debugPrint(
      'BG_TEST: received in background: '
      '${caption.original!.text} / ${caption.translations['ja']!.text}',
    );

    // 3. 前面に戻ると、裏で届いた字幕が出ている
    await waitUntil(
      () => _lifecycle == AppLifecycleState.resumed,
      timeout: const Duration(seconds: 30),
      reason: '前面に戻る(send_home_when_joined.sh)',
    );
    await pumpUntil(
      tester,
      () => shows(find.textContaining('[en] ')),
      reason: '裏で届いた字幕',
    );

    // 4. 退室する。サービスが止まったかはホストが確かめる
    await tester.pageBack();
    await pumpUntil(
      tester,
      () => shows(find.byType(RoomsScreen)) && !shows(find.byType(RoomScreen)),
      reason: '退室',
    );
    debugPrint('BG_TEST: left');
    await Future<void>.delayed(const Duration(seconds: 5));
  });
}
