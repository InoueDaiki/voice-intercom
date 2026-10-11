// ローカルの環境(API、模擬 OIDC、LiveKit、Agent)につないで、プロフィールの登録から入室、
// テキスト入力、PTT、字幕、履歴までを通す。README の「統合テスト」を参照。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'helpers.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('プロフィールから入室、テキスト、PTT、字幕、履歴まで', (tester) async {
    // 1〜2. ログイン、プロフィール、入室(helpers.dart)
    await enterRoom(tester);

    // 3. 入室してすぐテキストを送る。Agent が捨てたら送り直しで届く
    await tester.enterText(
      find.byKey(const Key('textInput')),
      '在庫は残り1,250個です。',
    );
    await tester.tap(find.byKey(const Key('sendText')));
    await pumpUntil(
      tester,
      () =>
          shows(find.textContaining('[ja] 在庫は残り1,250個です。')) &&
          !shows(find.textContaining('送信中')),
      timeout: const Duration(seconds: 20),
      reason: '自分のテキストの字幕',
    );
    expect(find.textContaining('届かなかった'), findsNothing);

    // 4. PTT。押している間だけミュートが外れる
    final gesture = await tester.startGesture(
      tester.getCenter(find.byKey(const Key('ptt'))),
    );
    await pumpUntil(
      tester,
      () => shows(find.text('話しています')),
      reason: 'ミュートを外す',
    );
    await tester.pump(const Duration(seconds: 3));
    await gesture.up();
    await pumpUntil(tester, () => shows(find.text('押して話す')), reason: 'ミュートに戻す');

    // 5. ほかの話者(英語)の字幕。原文と日本語の訳が並ぶ
    await pumpUntil(
      tester,
      () =>
          shows(find.textContaining('[en] ')) &&
          shows(find.textContaining('[ja] ', skipOffstage: false)),
      timeout: const Duration(seconds: 120),
      reason: '英語の話者の字幕(devContainer で publish_wav.py を流す)',
    );
    await pumpUntil(
      tester,
      () => find
          .textContaining('[ja] ')
          .evaluate()
          .any((e) => !(e.widget as Text).data!.contains('在庫')),
      timeout: const Duration(seconds: 60),
      reason: '英語の発話の日本語訳',
    );
    // 画面を撮る時間
    await tester.pump(const Duration(seconds: 5));

    // 6. 履歴
    await tester.tap(find.byIcon(Icons.history));
    await pumpUntil(
      tester,
      () => shows(find.textContaining('・ テキスト ・')),
      reason: '履歴',
    );
    await tester.pump(const Duration(seconds: 5));
  });
}
