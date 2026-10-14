import 'package:voice_intercom_api_client/api.dart';

import 'auth.dart';
import 'config.dart';

/// REST API の呼び出し。生成したクライアント(packages/api-client/dart)に、
/// 呼ぶたびに新しいアクセストークンを付ける。
class Api {
  Api(this._auth);

  final AuthService _auth;
  final HttpBearerAuth _bearer = HttpBearerAuth();
  late final ApiClient _client = ApiClient(
    basePath: AppConfig.apiBaseUrl,
    authentication: _bearer,
  );

  Future<T> _call<T>(Future<T> Function(ApiClient client) f) async {
    _bearer.accessToken = await _auth.accessToken();
    return f(_client);
  }

  /// 自分のプロフィール。未登録なら null
  Future<User?> getMyProfile() => _call((c) async {
    try {
      return await UsersApi(c).getMyProfile();
    } on ApiException catch (e) {
      if (e.code == 404) {
        return null;
      }
      rethrow;
    }
  });

  Future<User?> putMyProfile(String displayName, String language) => _call((c) {
    final lang = PutUserRequestLanguageEnum.fromJson(language);
    if (lang == null) {
      throw ArgumentError.value(language, 'language');
    }
    return UsersApi(c)
        .putMyProfile(PutUserRequest(displayName: displayName, language: lang));
  });

  Future<List<Room>> listRooms() =>
      _call((c) async => (await RoomsApi(c).listRooms())?.items ?? []);

  /// LiveKit の参加用トークン。プロフィールが未登録なら 409 の [ApiException]
  Future<LiveKitTokenResponse> createLiveKitToken(String roomId) =>
      _call((c) async {
        final res = await LivekitApi(c)
            .createLiveKitToken(LiveKitTokenRequest(roomName: roomId));
        if (res == null) {
          throw ApiException(500, 'トークンの応答が空');
        }
        return res;
      });

  /// 履歴を新しい順に。before は前の応答の next_before
  Future<TimelinePage> listTimeline(
    String roomId, {
    int limit = 50,
    String? before,
  }) => _call((c) async {
    final res = await TimelineApi(c)
        .listTimeline(roomId, limit: limit, before: before);
    return res ?? TimelinePage(items: [], nextBefore: null);
  });

  /// 履歴の1件(強い整合の読み取り)。無ければ null。消した行は deleted が付く
  Future<TimelineEvent?> getTimelineEvent(String roomId, String eventId) =>
      _call((c) async {
        try {
          return await TimelineApi(c).getTimelineEvent(roomId, eventId);
        } on ApiException catch (e) {
          if (e.code == 404) {
            return null;
          }
          rethrow;
        }
      });

  /// 自分の送ったテキスト入力か画像・動画を消す。墓石(deleted の付いた行)を返す。
  /// 2回目も同じ墓石を返す。他人のものや音声の発話は 403 の [ApiException]
  Future<TimelineEvent> deleteTimelineEvent(String roomId, String eventId) =>
      _call((c) async {
        final res = await TimelineApi(c).deleteTimelineEvent(roomId, eventId);
        if (res == null) {
          throw ApiException(500, '削除の応答が空');
        }
        return res;
      });

  /// 画像・動画を PUT する署名付き URL
  Future<MediaUpload> createMediaUpload(
    String roomId,
    CreateMediaUploadRequest request,
  ) => _call((c) async {
    final res = await MediaApi(c).createMediaUpload(roomId, request);
    if (res == null) {
      throw ApiException(500, 'uploads の応答が空');
    }
    return res;
  });

  /// アップロードした画像・動画を履歴に保存する。2回目からは同じ履歴を返す
  Future<TimelineEvent> completeMediaUpload(
    String roomId,
    String mediaId,
    CompleteMediaUploadRequest request,
  ) => _call((c) async {
    final res = await MediaApi(c).completeMediaUpload(roomId, mediaId, request);
    if (res == null) {
      throw ApiException(500, 'complete の応答が空');
    }
    return res;
  });
}
