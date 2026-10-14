import 'dart:async';
import 'dart:collection';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:voice_intercom_api_client/api.dart';

import 'http_put.dart';
import 'media_preparer.dart';

/// パートの署名付き URL を1回で取れる数(API の parts の上限)
const maxPartUrlsPerRequest = 100;

/// 送信中の画像・動画の段階。
enum OutgoingMediaState {
  /// 圧縮、サムネイルの作成
  preparing,

  /// 署名付き URL の取得と、本体(マルチパートならパートごと)・サムネイルの PUT
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

  /// uploads の応答。1回の PUT なら期限のうち、マルチパートならアップロードが無くなるまで
  /// (API が 404・410 を返すまで)、やり直しでも使い回す
  MediaUpload? ticket;
  bool bodyUploaded = false;
  bool thumbnailUploaded = false;

  /// マルチパートで PUT し終えたパートの ETag(パートの番号 → ETag)。やり直しでは送らない
  final Map<int, String> partEtags = {};

  /// マルチパートのパートの署名付き URL(期限のうちは使い回す)
  final Map<int, ({String url, DateTime expiresAt})> partUrls = {};

  /// complete の応答(履歴の行)
  TimelineEvent? event;

  /// 動画らしいか(整える前は分からないので、整えた後の値)
  bool get isVideo => prepared?.isVideo ?? false;

  bool get active =>
      state != OutgoingMediaState.done && state != OutgoingMediaState.failed;

  /// uploads からやり直す(送り終えたパートも捨てる)
  void resetTicket() {
    ticket = null;
    bodyUploaded = false;
    thumbnailUploaded = false;
    partEtags.clear();
    partUrls.clear();
  }
}

/// API と S3 への送信。テストでは差し替える。
abstract interface class MediaUploadBackend {
  Future<MediaUpload> createUpload(
    String roomId,
    CreateMediaUploadRequest request,
  );

  /// マルチパートのパート(と、[thumbnail] ならサムネイル)の署名付き URL
  Future<UploadPartUrls> partUrls(
    String roomId,
    String mediaId,
    List<int> partNumbers, {
    bool thumbnail = false,
  });

  /// ファイルの [offset] バイト目から [length] バイトを署名付き URL に PUT し、ETag を返す。
  /// [contentType] が null なら Content-Type を付けない(マルチパートのパート)。
  /// [onProgress] は送ったバイト数
  Future<String?> putFile(
    String url,
    String path,
    int length,
    String? contentType, {
    int offset = 0,
    void Function(int sent)? onProgress,
  });

  Future<void> putBytes(String url, Uint8List bytes, String contentType);

  /// マルチパートなら [parts] に全パートの番号と ETag を渡す
  Future<TimelineEvent> complete(
    String roomId,
    String mediaId, {
    List<CompletedPart>? parts,
  });
}

/// 画像・動画を送る。整える → uploads → 本体とサムネイルの PUT → complete。
///
/// - 1つずつ順に処理する(動画の圧縮は同時に1つしかできない。回線も分け合わない)。
/// - 失敗したら、その段階からやり直せる。整えたファイル、期限のうちの署名付き URL、
///   PUT し終えたものは使い回す。complete が 409(本体かサムネイルが無い)なら PUT からやり直す。
/// - complete は2回目からも同じ履歴を返すので、応答が失われたときに呼び直しても重ならない。
/// - 大きい本体(API が uploads で multipart を返したもの)は、パートに分けて [partConcurrency] 本
///   ずつ並べて PUT する。ファイルはパートごとに読む(全体をメモリに載せない)。失敗したパートは
///   その場で [partAttempts] 回まで送り直し、それでもだめなら失敗にする。やり直しでは、送り終えた
///   パートを除いて続きから送る。パートの署名付き URL は、送る前に100個ずつ取る。
/// - マルチパートで API が 404・410(アップロードが無い、完了できない)を返したら、uploads から
///   やり直す(送り終えたパートも捨てる)。complete の 409(サムネイルが無い)なら、サムネイルだけ
///   上げ直す。
class MediaUploader {
  MediaUploader({
    required this.roomId,
    required this.backend,
    required this.onChanged,
    required this.onCompleted,
    this.preparer = const DeviceMediaPreparer(),
    this.ticketMargin = const Duration(minutes: 5),
    this.partConcurrency = 4,
    this.partAttempts = 3,
    this.partRetryDelay = const Duration(seconds: 1),
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

  /// マルチパートで同時に PUT するパートの数
  final int partConcurrency;

  /// 1つのパートを続けて送ってみる回数(失敗したパートだけ送り直す)
  final int partAttempts;

  /// パートを送り直す前に待つ時間(2回目からは倍にする)
  final Duration partRetryDelay;

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
      if (e is ApiException &&
          (e.code == 404 || e.code == 410) &&
          item.ticket?.multipart != null) {
        // マルチパートのアップロードが無い(期限で消えた)か、完了できない。uploads からやり直す
        item.resetTicket();
      }
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
    // マルチパートは、期限が過ぎても URL を取り直して続ける(送り終えたパートを捨てない)
    if (ticket == null || (ticket.multipart == null && _expiring(ticket))) {
      final contentType = CreateMediaUploadRequestContentTypeEnum.fromJson(
        media.contentType,
      );
      if (contentType == null) {
        throw UnsupportedMediaException('この形式は送れない(${media.contentType})');
      }
      item.resetTicket();
      item.ticket = await backend.createUpload(
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
      );
    }
    final current = item.ticket!;
    if (current.multipart != null) {
      await _uploadMultipart(item, current);
      item.progress = 1;
      return;
    }
    final thumbnail = media.thumbnail;
    final total = media.sizeBytes + (thumbnail?.length ?? 0);
    if (!item.bodyUploaded) {
      final uploadUrl = current.uploadUrl;
      if (uploadUrl == null) {
        throw StateError('uploads の応答に upload_url が無い');
      }
      await backend.putFile(
        uploadUrl,
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

  /// マルチパート。サムネイルを先に上げ(complete がサムネイルを先に確かめるので)、
  /// 送っていないパートを [partConcurrency] 本ずつ並べて PUT する。
  Future<void> _uploadMultipart(OutgoingMedia item, MediaUpload ticket) async {
    final media = item.prepared!;
    final multipart = ticket.multipart!;
    final mediaId = ticket.mediaId;
    final thumbnail = media.thumbnail;
    final total = media.sizeBytes + (thumbnail?.length ?? 0);
    int partLength(int n) =>
        min(multipart.partSize, media.sizeBytes - (n - 1) * multipart.partSize);

    // 進み具合は、送り終えたパートと、送っている途中のパートの合計
    final inFlight = <int, int>{};
    void report() {
      var sent = item.thumbnailUploaded ? (thumbnail?.length ?? 0) : 0;
      for (final n in item.partEtags.keys) {
        sent += partLength(n);
      }
      for (final v in inFlight.values) {
        sent += v;
      }
      item.progress = total == 0 ? null : sent / total;
      _changed();
    }

    report();
    if (thumbnail != null && !item.thumbnailUploaded) {
      var url = ticket.thumbnailUploadUrl;
      if (url == null || _expiring(ticket)) {
        final res = await backend.partUrls(
          roomId,
          mediaId,
          const [],
          thumbnail: true,
        );
        url = res.thumbnailUploadUrl;
      }
      if (url == null) {
        throw StateError('サムネイルの署名付き URL が無い');
      }
      await backend.putBytes(url, thumbnail, 'image/jpeg');
      item.thumbnailUploaded = true;
      report();
    }

    final remaining = Queue<int>.of([
      for (var n = 1; n <= multipart.partCount; n++)
        if (!item.partEtags.containsKey(n)) n,
    ]);
    // URL を取るのは同時に1回だけ(並べた PUT が、同じパートの URL を重ねて取らないように)
    Future<void>? fetching;

    bool fresh(int n) {
      final cached = item.partUrls[n];
      return cached != null &&
          _now().add(ticketMargin).isBefore(cached.expiresAt);
    }

    Future<String> urlFor(int n) async {
      while (!fresh(n)) {
        final pending = fetching;
        if (pending != null) {
          await pending;
          continue;
        }
        // n と、この後に送るパートのうち URL の無いものを、まとめて取る
        final numbers = [
          n,
          ...remaining.where((m) => !fresh(m)).take(maxPartUrlsPerRequest - 1),
        ];
        final done = () async {
          final res = await backend.partUrls(roomId, mediaId, numbers);
          final expiresAt = DateTime.parse(res.expiresAt);
          for (final p in res.parts) {
            item.partUrls[p.partNumber] = (url: p.url, expiresAt: expiresAt);
          }
          if (!fresh(n)) {
            throw StateError('パート $n の署名付き URL を取れなかった');
          }
        }();
        fetching = done;
        try {
          await done;
        } finally {
          fetching = null;
        }
      }
      return item.partUrls[n]!.url;
    }

    Future<void> sendPart(int n) async {
      for (var attempt = 1; ; attempt++) {
        try {
          final url = await urlFor(n);
          inFlight[n] = 0;
          final etag = await backend.putFile(
            url,
            media.path,
            partLength(n),
            null,
            offset: (n - 1) * multipart.partSize,
            onProgress: (sent) {
              inFlight[n] = sent;
              report();
            },
          );
          if (etag == null || etag.isEmpty) {
            throw StateError('パート $n の応答に ETag が無い');
          }
          inFlight.remove(n);
          item.partEtags[n] = etag;
          report();
          return;
        } catch (e) {
          inFlight.remove(n);
          // URL の取得(API)の失敗は、ここでは送り直さない(アップロードが無い 404 などは、
          // やり直しで uploads からにする)
          if (e is ApiException || attempt >= partAttempts) {
            rethrow;
          }
          if (e is PutFailedException && e.statusCode == 403) {
            // 署名付き URL の期限切れなど。URL を取り直す
            item.partUrls.remove(n);
          }
          debugPrint('パート $n を送り直す($attempt 回目の失敗): $e');
          await Future<void>.delayed(partRetryDelay * (1 << (attempt - 1)));
        }
      }
    }

    Object? failure;
    StackTrace? failureStack;
    Future<void> worker() async {
      while (failure == null && remaining.isNotEmpty && !_disposed) {
        final n = remaining.removeFirst();
        try {
          await sendPart(n);
        } catch (e, st) {
          failure ??= e;
          failureStack ??= st;
        }
      }
    }

    await Future.wait([
      for (var i = 0; i < min(partConcurrency, remaining.length); i++) worker(),
    ]);
    final error = failure;
    if (error != null) {
      Error.throwWithStackTrace(error, failureStack!);
    }
    if (item.partEtags.length != multipart.partCount) {
      throw StateError('パートを送り終えていない');
    }
  }

  Future<void> _complete(OutgoingMedia item) async {
    _set(item, OutgoingMediaState.completing);
    final ticket = item.ticket!;
    final multipart = ticket.multipart != null;
    final List<CompletedPart>? parts;
    if (multipart) {
      final numbers = item.partEtags.keys.toList()..sort();
      parts = [
        for (final n in numbers)
          CompletedPart(partNumber: n, etag: item.partEtags[n]!),
      ];
    } else {
      parts = null;
    }
    final TimelineEvent event;
    try {
      event = await backend.complete(roomId, ticket.mediaId, parts: parts);
    } on ApiException catch (e) {
      if (e.code == 409) {
        // 本体かサムネイルが置かれていない(か、大きさが違う)。PUT からやり直す。
        // マルチパートの 409 はサムネイルだけ(本体は完了させてから確かめ、だめなら 410)
        item.thumbnailUploaded = false;
        if (!multipart) {
          item.bodyUploaded = false;
        }
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
