import 'dart:async';

import 'package:flutter/services.dart';

import 'video_plan.dart';

/// 動画を測り、H.264 の MP4 にし、フレームを取り出す(ネイティブ。設計メモの「動画の解像度とビットレート」)。
///
/// - iOS: `AVAssetReader` と `AVAssetWriter`(`shouldOptimizeForNetworkUse` で `moov` を先頭に置く)。
///   入れ直すだけのときは `AVAssetExportSession` のパススルー。`ios/Runner/VideoTranscoderPlugin.swift`
/// - Android: Media3 Transformer(`InAppMp4Muxer` で `moov` を先頭に置く)。
///   `android/app/src/main/kotlin/.../VideoTranscoder.kt`
///
/// 同時に1つしか符号化しない(呼ぶ側で順に呼ぶ)。
class VideoTranscoder {
  const VideoTranscoder();

  static const _channel = MethodChannel('voiceintercom/video');

  static void Function(double progress)? _onProgress;
  static bool _handlerSet = false;

  /// 元の動画を測る。動画のトラックが無ければ例外
  Future<VideoProbe> probe(String path) async {
    final map = await _channel.invokeMapMethod<Object?, Object?>('probe', {
      'path': path,
    });
    if (map == null) {
      throw StateError('動画を読めなかった');
    }
    return VideoProbe.fromMap(map);
  }

  /// [path] を H.264 の MP4 にして [outPath] に書く。[videoBitrate] が null なら、
  /// 符号化し直さずに MP4 に入れ直す(元が H.264 のときだけ)。
  /// 解像度・フレームレートは元のまま、音声は AAC(元が AAC で入れ直すだけならそのまま)。
  /// [onProgress] は 0〜1。
  Future<void> transcode(
    String path,
    String outPath, {
    int? videoBitrate,
    void Function(double progress)? onProgress,
  }) async {
    if (!_handlerSet) {
      _channel.setMethodCallHandler((call) async {
        if (call.method == 'progress' && call.arguments is num) {
          _onProgress?.call((call.arguments as num).toDouble().clamp(0, 1));
        }
      });
      _handlerSet = true;
    }
    _onProgress = onProgress;
    try {
      await _channel.invokeMethod<void>('transcode', {
        'path': path,
        'outPath': outPath,
        'videoBitrate': videoBitrate,
      });
    } finally {
      _onProgress = null;
    }
  }

  /// 向きを反映したフレーム(JPEG。長い辺 [maxSide] まで)。取り出せなければ null
  Future<Uint8List?> frame(String path, {int maxSide = 960}) => _channel
      .invokeMethod<Uint8List>('frame', {'path': path, 'maxSide': maxSide});
}
