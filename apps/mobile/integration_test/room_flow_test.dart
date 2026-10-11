// ローカルの環境(API、模擬 OIDC、LiveKit、Agent)につないで、プロフィールの登録から入室、
// テキスト入力、PTT、字幕、履歴までを通す。README の「統合テスト」を参照。
//
// ログインだけはブラウザを操作できないので、模擬 OIDC のログイン画面のフォームを直接送って
// トークンを取る(README の「ローカルで API を動かす」の curl と同じ流れ)。
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:voice_intercom/app_state.dart';
import 'package:voice_intercom/auth.dart';
import 'package:voice_intercom/config.dart';
import 'package:voice_intercom/main.dart';

const _user = String.fromEnvironment('TEST_USER', defaultValue: 'alice');
const _roomName = String.fromEnvironment(
  'TEST_ROOM_NAME',
  defaultValue: 'モバイル確認',
);

/// 模擬 OIDC のフォームを送ってトークンを取る(ブラウザを使わない)
class _MockOidcAuth extends AuthService {
  String? _token;

  @override
  bool get signedIn => _token != null;

  @override
  Future<bool> restore() async {
    final issuer = AppConfig.oidcIssuer;
    const redirect = 'voiceintercom://callback';
    final authorize =
        http.Request(
            'POST',
            Uri.parse('$issuer/authorize').replace(
              queryParameters: {
                'client_id': AppConfig.oidcClientId,
                'response_type': 'code',
                'scope': 'openid',
                'state': 'x',
                'redirect_uri': redirect,
              },
            ),
          )
          ..followRedirects = false
          ..bodyFields = {
            'username': _user,
            'claims': jsonEncode({
              'token_use': 'access',
              'client_id': AppConfig.oidcClientId,
            }),
          };
    final res = await http.Client().send(authorize);
    final location = res.headers['location']!;
    final code = Uri.parse(location).queryParameters['code']!;
    final token = await http.post(
      Uri.parse('$issuer/token'),
      body: {
        'grant_type': 'authorization_code',
        'code': code,
        'client_id': AppConfig.oidcClientId,
        'redirect_uri': redirect,
      },
    );
    _token =
        (jsonDecode(token.body) as Map<String, dynamic>)['access_token']
            as String;
    return true;
  }

  @override
  Future<String> accessToken() async => _token!;

  @override
  Future<void> signOut() async => _token = null;
}

Future<void> pumpUntil(
  WidgetTester tester,
  bool Function() done, {
  Duration timeout = const Duration(seconds: 30),
  String? reason,
}) async {
  final end = DateTime.now().add(timeout);
  while (!done()) {
    if (DateTime.now().isAfter(end)) {
      fail('待ちきれなかった: ${reason ?? ''}');
    }
    await tester.pump(const Duration(milliseconds: 200));
  }
}

bool _shows(Finder f) => f.evaluate().isNotEmpty;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('プロフィールから入室、テキスト、PTT、字幕、履歴まで', (tester) async {
    final state = AppState(auth: _MockOidcAuth());
    await tester.pumpWidget(VoiceIntercomApp(state: state));
    await state.start();
    await pumpUntil(
      tester,
      () =>
          state.stage == AppStage.ready || state.stage == AppStage.needsProfile,
      reason: 'ログインとプロフィールの読み込み',
    );

    // 1. プロフィール(未登録なら登録する。言語は既定の日本語)
    if (state.stage == AppStage.needsProfile) {
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('displayName')), 'アリス');
      await tester.tap(find.text('登録'));
      await pumpUntil(tester, () => state.stage == AppStage.ready);
    }
    expect(state.profile!.language.toJson(), 'ja');

    // 2. ルームの一覧から入室する
    await pumpUntil(
      tester,
      () => _shows(find.text(_roomName)),
      reason: 'ルームの一覧',
    );
    await tester.tap(find.text(_roomName));
    await pumpUntil(
      tester,
      () => _shows(find.textContaining('で聞く')),
      reason: '入室',
    );

    // 3. 入室してすぐテキストを送る。Agent が捨てたら送り直しで届く
    await tester.enterText(
      find.byKey(const Key('textInput')),
      '在庫は残り1,250個です。',
    );
    await tester.tap(find.byKey(const Key('sendText')));
    await pumpUntil(
      tester,
      () =>
          _shows(find.textContaining('[ja] 在庫は残り1,250個です。')) &&
          !_shows(find.textContaining('送信中')),
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
      () => _shows(find.text('話しています')),
      reason: 'ミュートを外す',
    );
    await tester.pump(const Duration(seconds: 3));
    await gesture.up();
    await pumpUntil(
      tester,
      () => _shows(find.text('押して話す')),
      reason: 'ミュートに戻す',
    );

    // 5. ほかの話者(英語)の字幕。原文と日本語の訳が並ぶ
    await pumpUntil(
      tester,
      () =>
          _shows(find.textContaining('[en] ')) &&
          _shows(find.textContaining('[ja] ', skipOffstage: false)),
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
      () => _shows(find.textContaining('・ テキスト ・')),
      reason: '履歴',
    );
    await tester.pump(const Duration(seconds: 5));
  });
}
