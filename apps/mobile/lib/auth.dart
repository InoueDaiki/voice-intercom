import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'config.dart';

/// 標準の OIDC(認可コード + PKCE)でログインし、アクセストークンを持つ。
///
/// 本番は Cognito、ローカルは模擬 OIDC(README の「ローカルの認証」)。どちらも探索で
/// エンドポイントを得るので、アプリに分岐はない。リフレッシュトークンは端末の安全な保存先
/// (iOS は Keychain、Android は Keystore で暗号化)に置き、次の起動でログインを省く。
class AuthService {
  AuthService({FlutterAppAuth? appAuth, FlutterSecureStorage? storage})
    : _appAuth = appAuth ?? const FlutterAppAuth(),
      _storage = storage ?? const FlutterSecureStorage();

  static const _refreshTokenKey = 'refresh_token';

  /// 期限の手前でトークンを取り直す余裕
  static const _refreshMargin = Duration(seconds: 60);

  final FlutterAppAuth _appAuth;
  final FlutterSecureStorage _storage;
  String? _accessToken;
  DateTime? _expiresAt;
  String? _refreshToken;
  Future<void>? _refreshing;

  bool get signedIn => _accessToken != null;

  // 模擬 OIDC は http なので、そのときだけ平文の接続を許す(Android の AppAuth は既定で断る)
  bool get _insecure => AppConfig.oidcIssuer.startsWith('http://');

  /// 保存したリフレッシュトークンでログインし直す。できなければ false
  Future<bool> restore() async {
    try {
      _refreshToken = await _storage.read(key: _refreshTokenKey);
    } on Exception {
      _refreshToken = null;
    }
    if (_refreshToken == null) {
      return false;
    }
    try {
      await _refresh();
      return true;
    } on Exception {
      await signOut();
      return false;
    }
  }

  Future<void> signIn() async {
    final res = await _appAuth.authorizeAndExchangeCode(
      AuthorizationTokenRequest(
        AppConfig.oidcClientId,
        AppConfig.oidcRedirectUrl,
        issuer: AppConfig.oidcIssuer,
        scopes: AppConfig.oidcScopes,
        allowInsecureConnections: _insecure,
        // ブラウザの Cookie を共有しない。ログアウトの後に、前の人のセッションで入らないように
        externalUserAgent:
            ExternalUserAgent.ephemeralAsWebAuthenticationSession,
      ),
    );
    await _save(res);
  }

  /// ログアウトする。端末のトークンを消すだけで、OIDC のセッションは終わらせない
  /// (ログインは毎回 Cookie を共有しないブラウザで行うので、次のログインに残らない)
  Future<void> signOut() async {
    _accessToken = null;
    _expiresAt = null;
    _refreshToken = null;
    try {
      await _storage.delete(key: _refreshTokenKey);
    } on Exception {
      // 消せなくても、メモリのトークンは消えている
    }
  }

  /// API に付けるアクセストークン。期限が近ければ取り直す
  Future<String> accessToken() async {
    final expiresAt = _expiresAt;
    if (_accessToken == null ||
        (expiresAt != null &&
            DateTime.now().isAfter(expiresAt.subtract(_refreshMargin)))) {
      await (_refreshing ??= _refresh().whenComplete(() => _refreshing = null));
    }
    final token = _accessToken;
    if (token == null) {
      throw StateError('ログインしていない');
    }
    return token;
  }

  Future<void> _refresh() async {
    final refreshToken = _refreshToken;
    if (refreshToken == null) {
      throw StateError('ログインしていない');
    }
    final res = await _appAuth.token(
      TokenRequest(
        AppConfig.oidcClientId,
        AppConfig.oidcRedirectUrl,
        issuer: AppConfig.oidcIssuer,
        refreshToken: refreshToken,
        grantType: GrantType.refreshToken,
        allowInsecureConnections: _insecure,
      ),
    );
    await _save(res);
  }

  Future<void> _save(TokenResponse res) async {
    _accessToken = res.accessToken;
    _expiresAt = res.accessTokenExpirationDateTime;
    // Cognito はリフレッシュで新しいリフレッシュトークンを返さないので、前のものを使い続ける
    final refreshToken = res.refreshToken;
    if (refreshToken != null && refreshToken.isNotEmpty) {
      _refreshToken = refreshToken;
      try {
        await _storage.write(key: _refreshTokenKey, value: refreshToken);
      } on Exception {
        // 保存できなくても、この起動の間は使える
      }
    }
  }
}
