import 'dart:async';
import 'dart:io';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:image/image.dart' as img;
import 'package:video_compress/video_compress.dart';

import 'media_type.dart';

/// 本体の上限(API の CreateMediaUploadRequest の size_bytes の上限。マルチパートは未対応)
const maxUploadBytes = 100 * 1024 * 1024;

/// 動画の長さの上限(案。設計メモの「端末での圧縮」で値は未定)。
/// image_picker の maxDuration はカメラで撮るときにしか効かないので、選んだ後にも確かめる。
const maxVideoDuration = Duration(minutes: 3);

/// 画像のサムネイルを作る大きさの境目(設計メモの「サムネイル」の例)
const imageThumbnailThreshold = 1024 * 1024;

/// サムネイルの長い辺のピクセル数
const thumbnailMaxSide = 480;

/// 幅・高さの上限(API の CreateMediaUploadRequest の width・height の上限)
const maxMediaSide = 65535;

/// 動画の長さの上限(API の CreateMediaUploadRequest の duration_ms の上限。24時間)
const maxMediaDurationMs = 24 * 60 * 60 * 1000;

/// 表示の幅と高さ(ピクセル。向きを反映した後。縦向きなら height が大きい)
typedef MediaSize = ({int width, int height});

/// API が受け付ける幅・高さなら返す(どちらかが無いか範囲の外なら null。送らない)
MediaSize? validSize(int? width, int? height) {
  bool ok(int? v) => v != null && v >= 1 && v <= maxMediaSide;
  if (!ok(width) || !ok(height)) {
    return null;
  }
  return (width: width!, height: height!);
}

/// API が受け付ける動画の長さ(ミリ秒)にする。分からないか範囲の外なら null(送らない)
int? validDurationMs(num? ms) {
  if (ms == null || !ms.isFinite) {
    return null;
  }
  final rounded = ms.round();
  return rounded >= 1 && rounded <= maxMediaDurationMs ? rounded : null;
}

/// 送る形に整えた画像・動画。
class PreparedMedia {
  PreparedMedia({
    required this.path,
    required this.contentType,
    required this.sizeBytes,
    required this.isVideo,
    this.thumbnail,
    this.temporary = false,
    this.size,
    this.durationMs,
  });

  /// 本体のファイル
  final String path;

  /// uploads に渡す content_type(image/jpeg、image/png、image/webp、image/heic、video/mp4)
  final String contentType;
  final int sizeBytes;
  final bool isVideo;

  /// サムネイル(image/jpeg)。無ければ null
  final Uint8List? thumbnail;

  /// 本体がこのアプリの作った一時ファイルなら true(送り終えたら消す)
  final bool temporary;

  /// 整えた後の本体の表示の大きさ(向きを反映した後)。測れなければ null
  final MediaSize? size;

  /// 動画の長さ(ミリ秒)。画像と、分からないときは null
  final int? durationMs;

  int? get width => size?.width;
  int? get height => size?.height;
}

/// 送れない画像・動画(形式、大きさ、長さ)。やり直しても同じなので、やり直させない。
class UnsupportedMediaException implements Exception {
  UnsupportedMediaException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// 選んだファイルを、送る形(JPEG などの画像、H.264 の MP4)に整え、サムネイルを作る。
abstract interface class MediaPreparer {
  /// [onProgress] は 0〜1(動画の圧縮の進み具合)
  Future<PreparedMedia> prepare(
    String path, {
    void Function(double progress)? onProgress,
  });
}

/// 端末での圧縮(設計メモの「端末での圧縮」)。
///
/// - 画像: image_picker に imageQuality と maxWidth を渡して選ぶ(JPEG になる見込み。
///   実機で確かめる)。届いた中身の形式で content_type を決め、API が受け付けない形式
///   (GIF など)は JPEG にする。1MB を超えたらサムネイルを作る。HEIC はこのアプリでは
///   読めないので、サムネイルなしでそのまま送る(幅・高さも送らない)。
/// - 動画: video_compress で H.264 の MP4(1280x720 まで)にし、サムネイルを作る。
///   圧縮は同時に1つしかできない(video_compress の制約)ので、呼ぶ側で順に呼ぶ。
/// - 幅・高さ: 整えた後の本体の、向きを反映した後の大きさ(画像は EXIF の向き、動画は
///   回転のメタデータ)。受け手が表示の枠(縦横比)を先に取るのに使う。動画は長さも測る。
class DeviceMediaPreparer implements MediaPreparer {
  const DeviceMediaPreparer();

  @override
  Future<PreparedMedia> prepare(
    String path, {
    void Function(double progress)? onProgress,
  }) async {
    final type = sniffMediaType(await _readHead(path));
    if (type == SniffedType.video) {
      return _prepareVideo(path, onProgress);
    }
    if (type == SniffedType.unknown) {
      throw UnsupportedMediaException('この形式の画像・動画は送れない');
    }
    return prepareImage(path, type);
  }

  Future<PreparedMedia> _prepareVideo(
    String path,
    void Function(double progress)? onProgress,
  ) async {
    final info = await VideoCompress.getMediaInfo(path);
    final durationMs = info.duration;
    if (durationMs != null &&
        durationMs > maxVideoDuration.inMilliseconds + 500) {
      throw UnsupportedMediaException('動画は${maxVideoDuration.inMinutes}分までにする');
    }
    final subscription = VideoCompress.compressProgress$.subscribe(
      (percent) => onProgress?.call((percent / 100).clamp(0, 1)),
    );
    final MediaInfo? compressed;
    try {
      compressed = await VideoCompress.compressVideo(
        path,
        quality: VideoQuality.Res1280x720Quality,
        includeAudio: true,
      );
    } finally {
      subscription.unsubscribe();
    }
    final outPath = compressed?.path;
    if (compressed == null || outPath == null || compressed.isCancel == true) {
      throw StateError('動画を圧縮できなかった');
    }
    final size = await File(outPath).length();
    if (size > maxUploadBytes) {
      await _deleteQuietly(outPath);
      throw UnsupportedMediaException('圧縮しても 100MB を超えるので送れない');
    }
    // 動画のサムネイルは必ず作って上げる(設計メモの「サムネイル」)
    final frame = await VideoCompress.getByteThumbnail(outPath, quality: 70);
    if (frame == null) {
      await _deleteQuietly(outPath);
      throw StateError('動画のサムネイルを作れなかった');
    }
    final thumbnail = await Isolate.run(() => makeThumbnailWithSize(frame));
    if (thumbnail == null) {
      await _deleteQuietly(outPath);
      throw StateError('動画のサムネイルを作れなかった');
    }
    return PreparedMedia(
      path: outPath,
      contentType: 'video/mp4',
      sizeBytes: size,
      isVideo: true,
      thumbnail: thumbnail.thumbnail,
      temporary: true,
      size: orientVideoSize(
        compressed.width,
        compressed.height,
        frame: thumbnail.size,
      ),
      durationMs: validDurationMs(compressed.duration ?? durationMs),
    );
  }
}

/// 動画の表示の大きさ。
///
/// video_compress の幅・高さは、回転(縦向きで撮った動画)の扱いが当てにならない。
/// 3.1.4 の Android は、回転が 0・180 のときに幅と高さを入れ替え、90・270 では入れ替えない
/// (逆に見える)。iOS は preferredTransform を反映した値を返す。そこで、長い辺と短い辺は
/// [width]・[height] から取り、縦か横かは、向きを反映して取り出したフレーム([frame]。
/// Android の MediaMetadataRetriever.getFrameAtTime、iOS の appliesPreferredTrackTransform)
/// で決める。幅・高さが無ければフレームの大きさを使う。実機で確かめる。
MediaSize? orientVideoSize(int? width, int? height, {MediaSize? frame}) {
  final reported = validSize(width, height);
  if (reported == null) {
    return frame == null ? null : validSize(frame.width, frame.height);
  }
  if (frame == null) {
    return reported;
  }
  final long = max(reported.width, reported.height);
  final short = min(reported.width, reported.height);
  return frame.width >= frame.height
      ? (width: long, height: short)
      : (width: short, height: long);
}

/// 画像を送る形に整える。画像のデコードは重いので別の isolate で行う。
Future<PreparedMedia> prepareImage(String path, SniffedType type) async {
  final file = File(path);
  if (type.uploadableAsIs) {
    final size = await file.length();
    if (size > maxUploadBytes) {
      throw UnsupportedMediaException('100MB を超える画像は送れない');
    }
    if (type == SniffedType.heic) {
      // このアプリでは読めないので、サムネイルも幅・高さも無しで送る
      return PreparedMedia(
        path: path,
        contentType: type.mime,
        sizeBytes: size,
        isVideo: false,
      );
    }
    final withThumbnail = size > imageThumbnailThreshold;
    final analysed = await Isolate.run(
      () => _analyseImage(path, withThumbnail: withThumbnail),
    );
    return PreparedMedia(
      path: path,
      contentType: type.mime,
      sizeBytes: size,
      isVideo: false,
      thumbnail: analysed.thumbnail,
      size: analysed.size,
    );
  }
  // GIF などは JPEG にする(動きは失う)
  final bytes = await file.readAsBytes();
  final converted = await Isolate.run(() => convertToJpeg(bytes));
  if (converted == null) {
    throw UnsupportedMediaException('この形式の画像は送れない');
  }
  final out = File(
    '${Directory.systemTemp.path}/vi_${DateTime.now().microsecondsSinceEpoch}.jpg',
  );
  await out.writeAsBytes(converted.image);
  return PreparedMedia(
    path: out.path,
    contentType: 'image/jpeg',
    sizeBytes: converted.image.length,
    isVideo: false,
    thumbnail: converted.image.length > imageThumbnailThreshold
        ? converted.thumbnail
        : null,
    temporary: true,
    size: converted.size,
  );
}

/// そのまま送る画像の、表示の大きさと(要るなら)サムネイル。別の isolate で呼ぶ
({Uint8List? thumbnail, MediaSize? size}) _analyseImage(
  String path, {
  required bool withThumbnail,
}) {
  final bytes = File(path).readAsBytesSync();
  return (
    thumbnail: withThumbnail ? makeThumbnail(bytes) : null,
    size: measureImage(bytes),
  );
}

/// 画像の表示の大きさ(EXIF の向きを反映した後)を、画素をデコードせずに読む。
/// 読めなければ null。
MediaSize? measureImage(Uint8List bytes) {
  try {
    final info = img.findDecoderForData(bytes)?.startDecode(bytes);
    if (info == null) {
      return null;
    }
    // EXIF の向きの 5〜8 は、90度か270度の回転を含む(幅と高さが入れ替わる)
    final orientation = sniffMediaType(bytes) == SniffedType.jpeg
        ? img.decodeJpgExif(bytes)?.imageIfd.orientation ?? 1
        : 1;
    final rotated = orientation >= 5 && orientation <= 8;
    return rotated
        ? validSize(info.height, info.width)
        : validSize(info.width, info.height);
  } on Object {
    // 壊れたファイルでは、デコーダーが Exception 以外(RangeError など)も投げる
    return null;
  }
}

/// サムネイル(image/jpeg、長い辺 [thumbnailMaxSide] まで)を作る。読めなければ null。
Uint8List? makeThumbnail(Uint8List bytes) =>
    makeThumbnailWithSize(bytes)?.thumbnail;

/// サムネイルと、元の画像の表示の大きさ(EXIF の向きを反映した後)。読めなければ null。
({Uint8List thumbnail, MediaSize? size})? makeThumbnailWithSize(
  Uint8List bytes,
) {
  final decoded = _decode(bytes);
  if (decoded == null) {
    return null;
  }
  final oriented = img.bakeOrientation(decoded);
  return (
    thumbnail: _thumbnailOf(oriented),
    size: validSize(oriented.width, oriented.height),
  );
}

/// 読めなければ null(壊れている、画素が多すぎるなど)
img.Image? _decode(Uint8List bytes) {
  try {
    return img.decodeImage(bytes);
  } on Exception {
    return null;
  }
}

/// [oriented] は EXIF の向きを画素に反映した後のもの(サムネイルには EXIF を残さない)
Uint8List _thumbnailOf(img.Image oriented) {
  final img.Image resized;
  if (oriented.width <= thumbnailMaxSide &&
      oriented.height <= thumbnailMaxSide) {
    resized = oriented;
  } else if (oriented.width >= oriented.height) {
    resized = img.copyResize(oriented, width: thumbnailMaxSide);
  } else {
    resized = img.copyResize(oriented, height: thumbnailMaxSide);
  }
  return img.encodeJpg(resized, quality: 75);
}

/// API が受け付けない形式の画像を JPEG にし、サムネイルも作る。読めなければ null。
({Uint8List image, Uint8List thumbnail, MediaSize? size})? convertToJpeg(
  Uint8List bytes,
) {
  final decoded = _decode(bytes);
  if (decoded == null) {
    return null;
  }
  final oriented = img.bakeOrientation(decoded);
  return (
    image: img.encodeJpg(oriented, quality: 85),
    thumbnail: _thumbnailOf(oriented),
    size: validSize(oriented.width, oriented.height),
  );
}

Future<Uint8List> _readHead(String path) async {
  final raf = await File(path).open();
  try {
    return await raf.read(sniffLength);
  } finally {
    await raf.close();
  }
}

Future<void> _deleteQuietly(String path) async {
  try {
    await File(path).delete();
  } on FileSystemException {
    // 消せなくても困らない(OS の一時領域)
  }
}

/// 送り終えた一時ファイルを消す
Future<void> deleteTemporary(PreparedMedia media) async {
  if (media.temporary) {
    await _deleteQuietly(media.path);
  }
}
