/// 接続先の設定。`--dart-define`(または `--dart-define-from-file`)で渡す。
///
/// ローカルでは DEV_HOST(.env にある LAN の IP)だけを渡せば、模擬 OIDC と API の URL が決まる
/// (README の「ローカルの認証」「ローカルで API を動かす」)。AWS の環境に向けるときは、
/// OIDC_ISSUER、OIDC_CLIENT_ID、API_BASE_URL を terraform output の値で渡す。
class AppConfig {
  static const devHost = String.fromEnvironment('DEV_HOST');

  /// トークンの iss。探索(/.well-known/openid-configuration)でエンドポイントを得る
  static const oidcIssuer = String.fromEnvironment(
    'OIDC_ISSUER',
    defaultValue: devHost == '' ? '' : 'http://$devHost:8090/default',
  );

  static const oidcClientId = String.fromEnvironment(
    'OIDC_CLIENT_ID',
    defaultValue: 'mobile',
  );

  /// Cognito のアプリクライアントに登録したコールバック(infra/envs/dev の mobile_callback_urls)
  static const oidcRedirectUrl = String.fromEnvironment(
    'OIDC_REDIRECT_URL',
    defaultValue: 'voiceintercom://callback',
  );

  /// Cognito のアプリクライアントで許可したスコープ(infra/modules/cognito の user_scopes)
  static const oidcScopes = ['openid', 'email', 'profile'];

  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: devHost == '' ? '' : 'http://$devHost:3000',
  );

  /// 足りない設定の名前。空なら起動できる
  static List<String> get missing => [
    if (oidcIssuer.isEmpty) 'OIDC_ISSUER(または DEV_HOST)',
    if (apiBaseUrl.isEmpty) 'API_BASE_URL(または DEV_HOST)',
  ];
}
