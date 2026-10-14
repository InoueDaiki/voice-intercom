import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

/// 動画の符号化の決め方(設計メモの「動画の解像度とビットレート」)。
///
/// 解像度とフレームレートは元のまま保ち、映像のビットレートを
/// 幅 × 高さ × 実効のフレームレート × [videoBitsPerPixel] で決める。元の映像のビットレートは超えない。
/// 元が既に H.264 で、ビットレートが目標に近ければ、符号化し直さない。

/// 1画素・1フレームあたりのビット数(H.264)。1080p30 で約 6.2Mbps、4K60 で約 37Mbps になる
const videoBitsPerPixel = 0.1;

/// 映像のビットレートの下限(小さい動画で画質が崩れないように。元のビットレートが低ければそちらに合わせる)
const minVideoBitrate = 1000 * 1000;

/// 元が H.264 のとき、目標のこの倍までなら符号化し直さない(画質を落としてまで縮めても得が小さい)
const keepBitrateTolerance = 1.25;

/// フレームレートが分からないときに使う値
const defaultFrameRate = 30.0;

/// 送る動画の音声のビットレート(1チャンネルあたり。ネイティブ側の AAC の設定と合わせる)
const audioBitratePerChannel = 96 * 1000;

/// ネイティブで測った元の動画(`VideoTranscoder.probe`)。
class VideoProbe {
  const VideoProbe({
    required this.width,
    required this.height,
    this.rotation = 0,
    this.durationMs,
    this.frameRate,
    this.videoBitrate,
    this.videoCodec,
    this.audioCodec,
    this.audioChannels,
  });

  factory VideoProbe.fromMap(Map<Object?, Object?> map) {
    int? asInt(Object? v) => v is num && v.isFinite ? v.round() : null;
    double? asDouble(Object? v) => v is num && v.isFinite ? v.toDouble() : null;
    return VideoProbe(
      width: asInt(map['width']) ?? 0,
      height: asInt(map['height']) ?? 0,
      rotation: asInt(map['rotation']) ?? 0,
      durationMs: asInt(map['durationMs']),
      frameRate: asDouble(map['frameRate']),
      videoBitrate: asInt(map['videoBitrate']),
      videoCodec: map['videoCodec'] as String?,
      audioCodec: map['audioCodec'] as String?,
      audioChannels: asInt(map['audioChannels']),
    );
  }

  /// 符号化された画素の幅・高さ(回転を反映する前)
  final int width;
  final int height;

  /// 表示するときの回転(0・90・180・270。時計回り)
  final int rotation;
  final int? durationMs;
  final double? frameRate;

  /// 映像のトラックのビットレート(bps)。分からなければ null
  final int? videoBitrate;

  /// `h264`、`hevc` など。分からなければ null
  final String? videoCodec;

  /// `aac` など。音声が無ければ null
  final String? audioCodec;
  final int? audioChannels;

  bool get hasAudio => audioCodec != null;

  /// 表示の幅・高さ(回転を反映した後)
  ({int width, int height}) get displaySize => rotation % 180 == 0
      ? (width: width, height: height)
      : (width: height, height: width);
}

/// 映像の目標のビットレート(bps)。[frameRate] は 30 までをそのまま、30〜60 を半分に数え、60 を超える分は数えない
/// (フレームが細かいほど前後のフレームが似ていて、1フレームあたりのビットが少なくて済む)。
int targetVideoBitrate(int width, int height, double? frameRate) {
  final fps = (frameRate == null || !frameRate.isFinite || frameRate <= 0)
      ? defaultFrameRate
      : frameRate;
  final effectiveFps = min(fps, 30.0) + max(0.0, min(fps, 60.0) - 30.0) / 2;
  final bitrate = (width * height * effectiveFps * videoBitsPerPixel).round();
  return max(bitrate, minVideoBitrate);
}

/// MP4 の箱の並び(先頭の階層だけ)。
class Mp4Layout {
  const Mp4Layout({required this.majorBrand, required this.moovBeforeMdat});

  /// ftyp の major brand(`isom`、`mp42`、QuickTime の MOV は `qt  `)
  final String majorBrand;

  /// `moov` が `mdat` より前にある(読みながら再生できる)
  final bool moovBeforeMdat;

  bool get isQuickTime => majorBrand == 'qt  ';
}

/// ファイルの先頭の階層の箱を見て、[Mp4Layout] を返す。MP4 / MOV でなければ null。
/// 箱の頭(8〜16バイト)だけを読むので、大きなファイルでもすぐ終わる。
Future<Mp4Layout?> readMp4Layout(String path) async {
  final raf = await File(path).open();
  try {
    final length = await raf.length();
    String? brand;
    var offset = 0;
    while (offset + 8 <= length) {
      await raf.setPosition(offset);
      final head = await raf.read(16);
      if (head.length < 8) {
        return null;
      }
      final data = ByteData.sublistView(head);
      var size = data.getUint32(0);
      final type = String.fromCharCodes(head.sublist(4, 8));
      if (size == 1) {
        if (head.length < 16) {
          return null;
        }
        size = data.getUint64(8);
      } else if (size == 0) {
        size = length - offset;
      }
      if (size < 8) {
        return null;
      }
      if (offset == 0) {
        if (type != 'ftyp' || head.length < 12) {
          return null;
        }
        brand = String.fromCharCodes(head.sublist(8, 12));
      } else if (type == 'moov') {
        return Mp4Layout(majorBrand: brand!, moovBeforeMdat: true);
      } else if (type == 'mdat') {
        return Mp4Layout(majorBrand: brand!, moovBeforeMdat: false);
      }
      offset += size;
    }
    return null;
  } finally {
    await raf.close();
  }
}

/// どう整えるか
sealed class VideoPlan {
  const VideoPlan();
}

/// そのまま送る(H.264 の MP4 で、moov が先頭にあり、ビットレートも目標に近い)
class SendAsIs extends VideoPlan {
  const SendAsIs();
}

/// 符号化し直さず、MP4 に入れ直す(moov を先頭に置く。MOV を MP4 にする)
class Remux extends VideoPlan {
  const Remux();
}

/// H.264 に符号化し直す
class Transcode extends VideoPlan {
  const Transcode(this.videoBitrate);

  /// 映像のビットレート(bps)
  final int videoBitrate;
}

/// 元の動画と箱の並びから、どう整えるかを決める。
VideoPlan planVideo(VideoProbe probe, Mp4Layout? layout) {
  final target = targetVideoBitrate(
    probe.displaySize.width,
    probe.displaySize.height,
    probe.frameRate,
  );
  final source = probe.videoBitrate;
  final isH264 = probe.videoCodec == 'h264';
  final audioOk = !probe.hasAudio || probe.audioCodec == 'aac';
  if (isH264 &&
      audioOk &&
      source != null &&
      source > 0 &&
      source <= target * keepBitrateTolerance) {
    if (layout != null && layout.moovBeforeMdat && !layout.isQuickTime) {
      return const SendAsIs();
    }
    return const Remux();
  }
  // 元のビットレートは超えない(分からなければ目標のまま)
  final bitrate = source != null && source > 0 ? min(target, source) : target;
  return Transcode(bitrate);
}

/// 整えた後の大きさの見積もり(バイト)。符号化する前に上限を超えそうか見るのに使う
int? estimateTranscodedBytes(VideoProbe probe, int videoBitrate) {
  final ms = probe.durationMs;
  if (ms == null || ms <= 0) {
    return null;
  }
  final audio = probe.hasAudio
      ? audioBitratePerChannel * min(max(probe.audioChannels ?? 2, 1), 2)
      : 0;
  return ((videoBitrate + audio) * ms / 1000 / 8).round();
}
