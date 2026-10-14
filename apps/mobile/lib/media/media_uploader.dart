import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:voice_intercom_api_client/api.dart';

import 'media_preparer.dart';

/// 送信中の画像・動画の段階。
enum OutgoingMediaState {
  /// 圧縮、サムネイルの作成
  preparing,

  /// 署名付き URL の取得と、本体・サムネイルの PUT
  uploading,

  /// complete(履歴への保存)
  completing,

  /// 履歴に保存できた
  done,

  /// どこかで失敗した。[OutgoingMedia.retryable] ならやり直せる
  failed,
}

/// 送信中の画像・動画1つ。送信者の画面にだけ出す(ほかの人には何も送らない)。
class OutgoingMedia {
  OutgoingMedia(this.localId, this.sourcePath);

  /// 端末の中だけの ID(media_id は uploads の後に決まる)
  final String localId;

  /// 選んだファイル
  final String sourcePath;

  OutgoingMediaState state = OutgoingMediaState.preparing;

  /// 今の段階の進み具合(0〜1)。分からなければ null
  double? progress;

  /// 失敗の理由(画面に出す)
  String? error;

  /// やり直して直る見込みがあるか(形式や大きさで送れないものは false)
  bool retryable = true;

  /// 整えた本体とサムネイル。やり直しでは作り直さない
  PreparedMedia? prepared;

  /// uploads の応答。期限のうちはやり直しでも使い回す
  MediaUpload? ticket;
  bool bodyUploaded = false;
  bool thumbnailUploaded = false;

  /// complete の応答(履歴の行)
  TimelineEvent? event;

  /// 動画らしいか(整える前は分からないので、整えた後の値)
  bool get isVideo => prepared?.isVideo ?? false;

  bool get active =>
      state != OutgoingMediaState.done && state != OutgoingMediaState.failed;
}

/// API と S3 への送信。テストでは差し替える。
abstract interface class MediaUploadBackend {
  Future<MediaUpload> createUpload(
    String roomId,
    CreateMediaUploadRequest request,
  );

  /// 署名付き URL に PUT する。[onProgress] は送ったバイト数
  Future<void> putFile(
    String url,
    String path,
    int length,
    String contentType, {
    void Function(int sent)? onProgress,
  });

  Future<void> putBytes(String url, Uint8List bytes, String contentType);

  Future<TimelineEvent> complete(String roomId, String mediaId);
}

/// 画像・動画を送る。整える → uploads → 本体とサムネイルの PUT → complete。
///
/// - 1つずつ順に処理する(動画の圧縮は同時に1つしかできない。回線も分け合わない)。
/// - 失敗したら、その段階からやり直せる。整えたファイル、期限のうちの署名付き URL、
///   PUT し終えたものは使い回す。complete が 409(本体かサムネイルが無い)なら PUT からやり直す。
/// - complete は2回目からも同じ履歴を返すので、応答が失われたときに呼び直しても重ならない。
class MediaUploader {
  MediaUploader({
    required this.roomId,
    required this.backend,
    required this.onChanged,
    required this.onCompleted,
    this.preparer = const DeviceMediaPreparer(),
    this.ticketMargin = const Duration(minutes: 5),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final String roomId;
  final MediaUploadBackend backend;
  final MediaPreparer preparer;

  /// 状態が変わったら呼ぶ(画面を描き直す)
  final void Function() onChanged;

  /// 履歴に保存できたら呼ぶ(ルームの表示にすぐ足す)
  final void Function(TimelineEvent event) onCompleted;

  /// 署名付き URL の期限まで、これより短ければ取り直す
  final Duration ticketMargin;
  final DateTime Function() _now;

  final List<OutgoingMedia> _items = [];
  Future<void> _queue = Future.value();
  int _nextId = 0;
  bool _disposed = false;

  /// 送った順。済んだものは除く
  List<OutgoingMedia> get items => _items
      .where((m) => m.state != OutgoingMediaState.done)
      .toList(growable: false);

  /// 選んだファイルを送る。画像・動画には文を添えられない(設計メモの「画像・動画のルームへの配信」)
  OutgoingMedia submit(String path) {
    final item = OutgoingMedia('local-${_nextId++}', path);
    _items.add(item);
    _enqueue(item);
    return item;
  }

  /// 失敗したものをやり直す
  void retry(OutgoingMedia item) {
    if (item.state != OutgoingMediaState.failed || !item.retryable) {
      return;
    }
    item
      ..state = item.prepared == null
          ? OutgoingMediaState.preparing
          : OutgoingMediaState.uploading
      ..error = null
      ..progress = null;
    _changed();
    _enqueue(item);
  }

  /// 失敗したものを諦めて、一覧から外す
  void dismiss(OutgoingMedia item) {
    if (item.active) {
      return;
    }
    _items.remove(item);
    _cleanup(item);
    _changed();
  }

  void dispose() {
    _disposed = true;
    for (final item in _items) {
      _cleanup(item);
    }
  }

  void _enqueue(OutgoingMedia item) {
    _queue = _queue.then((_) => _run(item));
  }

  Future<void> _run(OutgoingMedia item) async {
    if (_disposed) {
      return;
    }
    try {
      await _prepare(item);
      await _upload(item);
      await _complete(item);
    } on UnsupportedMediaException catch (e) {
      _fail(item, e.message, retryable: false);
    } catch (e) {
      _fail(item, _describe(item.state, e));
    }
  }

  Future<void> _prepare(OutgoingMedia item) async {
    if (item.prepared != null) {
      return;
    }
    _set(item, OutgoingMediaState.preparing);
    item.prepared = await preparer.prepare(
      item.sourcePath,
      onProgress: (p) {
        item.progress = p;
        _changed();
      },
    );
  }

  Future<void> _upload(OutgoingMedia item) async {
    final media = item.prepared!;
    _set(item, OutgoingMediaState.uploading);
    final ticket = item.ticket;
    if (ticket == null || _expiring(ticket)) {
      final contentType = CreateMediaUploadRequestContentTypeEnum.fromJson(
        media.contentType,
      );
      if (contentType == null) {
        throw UnsupportedMediaException('この形式は送れない(${media.contentType})');
      }
      item
        ..ticket = await backend.createUpload(
          roomId,
          CreateMediaUploadRequest(
            contentType: contentType,
            sizeBytes: media.sizeBytes,
            hasThumbnail: media.thumbnail != null,
            // 表示の枠(縦横比)と動画の長さ。整えた後の本体で測った値
            width: media.width,
            height: media.height,
            durationMs: media.durationMs,
          ),
        )
        ..bodyUploaded = false
        ..thumbnailUploaded = false;
    }
    final current = item.ticket!;
    final thumbnail = media.thumbnail;
    final total = media.sizeBytes + (thumbnail?.length ?? 0);
    if (!item.bodyUploaded) {
      await backend.putFile(
        current.uploadUrl,
        media.path,
        media.sizeBytes,
        media.contentType,
        onProgress: (sent) {
          item.progress = total == 0 ? null : sent / total;
          _changed();
        },
      );
      item.bodyUploaded = true;
    }
    final thumbnailUrl = current.thumbnailUploadUrl;
    if (thumbnail != null && thumbnailUrl != null && !item.thumbnailUploaded) {
      await backend.putBytes(thumbnailUrl, thumbnail, 'image/jpeg');
      item.thumbnailUploaded = true;
    }
    item.progress = 1;
  }

  Future<void> _complete(OutgoingMedia item) async {
    _set(item, OutgoingMediaState.completing);
    final TimelineEvent event;
    try {
      event = await backend.complete(roomId, item.ticket!.mediaId);
    } on ApiException catch (e) {
      if (e.code == 409) {
        // 本体かサムネイルが置かれていない(か、大きさが上限を超えた)。PUT からやり直す
        item
          ..bodyUploaded = false
          ..thumbnailUploaded = false;
      }
      rethrow;
    }
    item
      ..event = event
      ..state = OutgoingMediaState.done
      ..progress = null;
    _cleanup(item);
    if (!_disposed) {
      onCompleted(event);
    }
    _changed();
  }

  bool _expiring(MediaUpload ticket) {
    final expires = DateTime.tryParse(ticket.expiresAt);
    if (expires == null) {
      return true;
    }
    return _now().add(ticketMargin).isAfter(expires);
  }

  void _set(OutgoingMedia item, OutgoingMediaState state) {
    item
      ..state = state
      ..progress = null;
    _changed();
  }

  void _fail(OutgoingMedia item, String message, {bool retryable = true}) {
    debugPrint('画像・動画を送れなかった(${item.state.name}): $message');
    item
      ..state = OutgoingMediaState.failed
      ..error = message
      ..retryable = retryable
      ..progress = null;
    _changed();
  }

  String _describe(OutgoingMediaState stage, Object e) {
    final what = switch (stage) {
      OutgoingMediaState.preparing => '圧縮できなかった',
      OutgoingMediaState.uploading => 'アップロードできなかった',
      OutgoingMediaState.completing => '保存できなかった',
      _ => '送れなかった',
    };
    final detail = e is ApiException ? '${e.code}' : '$e';
    return '$what($detail)';
  }

  void _cleanup(OutgoingMedia item) {
    final media = item.prepared;
    if (media != null) {
      unawaited(deleteTemporary(media));
    }
  }

  void _changed() {
    if (!_disposed) {
      onChanged();
    }
  }
}
