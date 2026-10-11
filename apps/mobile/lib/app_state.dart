import 'package:flutter/foundation.dart';
import 'package:voice_intercom_api_client/api.dart';

import 'api.dart';
import 'auth.dart';

enum AppStage { starting, signedOut, needsProfile, ready }

/// ログインとプロフィールの状態。画面はこの段階で切り替える。
class AppState extends ChangeNotifier {
  AppState({AuthService? auth}) : auth = auth ?? AuthService() {
    api = Api(this.auth);
  }

  final AuthService auth;
  late final Api api;

  AppStage stage = AppStage.starting;
  User? profile;
  String? error;

  Future<void> start() async {
    if (await auth.restore()) {
      await _loadProfile();
    } else {
      _set(AppStage.signedOut);
    }
  }

  Future<void> signIn() async {
    error = null;
    try {
      await auth.signIn();
    } catch (e) {
      error = 'ログインできなかった: $e';
      _set(AppStage.signedOut);
      return;
    }
    await _loadProfile();
  }

  Future<void> signOut() async {
    await auth.signOut();
    profile = null;
    _set(AppStage.signedOut);
  }

  /// プロフィールを登録する。登録しないと LiveKit のトークンが 409 になる
  Future<void> saveProfile(String displayName, String language) async {
    error = null;
    try {
      profile = await api.putMyProfile(displayName, language);
    } catch (e) {
      error = '登録できなかった: $e';
      notifyListeners();
      return;
    }
    _set(AppStage.ready);
  }

  /// 登録したプロフィールを変える
  void editProfile() => _set(AppStage.needsProfile);

  /// 入室のときに 409 が返った(プロフィールが消えたなど)ら、登録からやり直す
  void profileMissing() {
    profile = null;
    _set(AppStage.needsProfile);
  }

  Future<void> _loadProfile() async {
    error = null;
    try {
      profile = await api.getMyProfile();
    } catch (e) {
      error = 'プロフィールを読めなかった: $e';
      _set(AppStage.signedOut);
      return;
    }
    _set(profile == null ? AppStage.needsProfile : AppStage.ready);
  }

  void _set(AppStage next) {
    stage = next;
    notifyListeners();
  }
}
