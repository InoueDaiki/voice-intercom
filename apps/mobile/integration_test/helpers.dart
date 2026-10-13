// 統合テストの共通部分。ログイン(模擬 OIDC)、プロフィールの登録、入室。
//
// ログインだけはブラウザを操作できないので、模擬 OIDC のログイン画面のフォームを直接送って
// トークンを取る(README の「ローカルで API を動かす」の curl と同じ流れ)。
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:voice_intercom/app_state.dart';
import 'package:voice_intercom/auth.dart';
import 'package:voice_intercom/config.dart';
import 'package:voice_intercom/main.dart';

const testUser = String.fromEnvironment('TEST_USER', defaultValue: 'alice');
const testRoomName = String.fromEnvironment(
  'TEST_ROOM_NAME',
  defaultValue: 'モバイル確認',
);

/// 模擬 OIDC のフォームを送ってトークンを取る(ブラウザを使わない)
class MockOidcAuth extends AuthService {
  MockOidcAuth({this.user = testUser, this.groups = const []});

  /// ユーザー名(sub になる)
  final String user;

  /// Cognito のグループ(`admin` で管理者)
  final List<String> groups;

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
            'username': user,
            'claims': jsonEncode({
              'token_use': 'access',
              'client_id': AppConfig.oidcClientId,
              if (groups.isNotEmpty) 'cognito:groups': groups,
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

bool shows(Finder f) => f.evaluate().isNotEmpty;

/// ログインし、プロフィールを(未登録なら)登録して、ルームの一覧から入室する
Future<AppState> enterRoom(WidgetTester tester) async {
  final state = AppState(auth: MockOidcAuth());
  await tester.pumpWidget(VoiceIntercomApp(state: state));
  await state.start();
  await pumpUntil(
    tester,
    () => state.stage == AppStage.ready || state.stage == AppStage.needsProfile,
    reason: 'ログインとプロフィールの読み込み',
  );

  // プロフィール(未登録なら登録する。言語は既定の日本語)
  if (state.stage == AppStage.needsProfile) {
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('displayName')), 'アリス');
    await tester.tap(find.text('登録'));
    await pumpUntil(tester, () => state.stage == AppStage.ready);
  }
  expect(state.profile!.language.toJson(), 'ja');

  // ルームの一覧から入室する
  await pumpUntil(
    tester,
    () => shows(find.text(testRoomName)),
    reason: 'ルームの一覧',
  );
  await tester.tap(find.text(testRoomName));
  await pumpUntil(
    tester,
    () => shows(find.textContaining('で聞く')),
    reason: '入室',
  );

  return state;
}
