import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:voice_intercom/media/media_preparer.dart';
import 'package:voice_intercom/media/video_plan.dart';
import 'package:voice_intercom/media/video_transcoder.dart';

/// 箱(大きさ 4 バイト + 種類 4 バイト + 中身)
List<int> box(String type, List<int> body) {
  final size = 8 + body.length;
  return [
    (size >> 24) & 0xff,
    (size >> 16) & 0xff,
    (size >> 8) & 0xff,
    size & 0xff,
    ...type.codeUnits,
    ...body,
  ];
}

List<int> ftyp(String brand) =>
    box('ftyp', [...brand.codeUnits, 0, 0, 0, 0, ...'isom'.codeUnits]);

const _mp4 = Mp4Layout(majorBrand: 'isom', moovBeforeMdat: true);

class FakeTranscoder implements VideoTranscoder {
  FakeTranscoder(this.source, {this.output});

  final VideoProbe source;
  final VideoProbe? output;
  final calls = <({String path, int? videoBitrate})>[];

  @override
  Future<VideoProbe> probe(String path) async =>
      path.endsWith('.mp4') && output != null && calls.isNotEmpty
      ? output!
      : source;

  @override
  Future<void> transcode(
    String path,
    String outPath, {
    int? videoBitrate,
    void Function(double progress)? onProgress,
  }) async {
    calls.add((path: path, videoBitrate: videoBitrate));
    onProgress?.call(1);
    File(outPath).writeAsBytesSync([...ftyp('isom'), ...box('moov', [])]);
  }

  @override
  Future<Uint8List?> frame(String path, {int maxSide = 960}) async =>
      img.encodeJpg(img.Image(width: 64, height: 36));
}

void main() {
  test('目標のビットレートは 幅×高さ×実効のフレームレート×0.1(30〜60fps は半分に数える)', () {
    expect(targetVideoBitrate(1920, 1080, 30), 6220800);
    expect(targetVideoBitrate(1920, 1080, 60), 9331200);
    expect(targetVideoBitrate(3840, 2160, 60), 37324800);
    expect(targetVideoBitrate(1280, 720, 30), 2764800);
    // 60fps を超える分は数えない
    expect(
      targetVideoBitrate(1920, 1080, 120),
      targetVideoBitrate(1920, 1080, 60),
    );
    // フレームレートが分からなければ 30fps とみなす
    expect(targetVideoBitrate(1920, 1080, null), 6220800);
    expect(targetVideoBitrate(1920, 1080, double.nan), 6220800);
    // 小さい動画は下限まで上げる
    expect(targetVideoBitrate(320, 240, 30), minVideoBitrate);
  });

  test('HEVC は、解像度とフレームレートに見合ったビットレートで H.264 にする', () {
    // iPhone の 4K60 の HEVC(縦向き)
    const probe = VideoProbe(
      width: 3840,
      height: 2160,
      rotation: 90,
      frameRate: 59.94,
      videoBitrate: 50000000,
      videoCodec: 'hevc',
      audioCodec: 'aac',
    );
    expect(probe.displaySize, (width: 2160, height: 3840));
    final plan = planVideo(probe, _mp4) as Transcode;
    expect(plan.videoBitrate, targetVideoBitrate(2160, 3840, 59.94));
  });

  test('元のビットレートは超えない', () {
    const probe = VideoProbe(
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoBitrate: 3000000,
      videoCodec: 'hevc',
    );
    expect((planVideo(probe, _mp4) as Transcode).videoBitrate, 3000000);
    // 元のビットレートが分からなければ目標のまま
    const unknown = VideoProbe(width: 1920, height: 1080, videoCodec: 'hevc');
    expect((planVideo(unknown, _mp4) as Transcode).videoBitrate, 6220800);
  });

  test('H.264 でビットレートが目標の1.25倍を超えれば、符号化し直す', () {
    const probe = VideoProbe(
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoBitrate: 17000000,
      videoCodec: 'h264',
      audioCodec: 'aac',
    );
    expect((planVideo(probe, _mp4) as Transcode).videoBitrate, 6220800);
  });

  test('H.264 でビットレートが目標に近ければ、符号化し直さない', () {
    const probe = VideoProbe(
      width: 1920,
      height: 1080,
      frameRate: 30,
      videoBitrate: 7000000,
      videoCodec: 'h264',
      audioCodec: 'aac',
    );
    // moov が先頭の MP4 ならそのまま
    expect(planVideo(probe, _mp4), isA<SendAsIs>());
    // moov が末尾、MOV、箱を読めないものは入れ直す
    expect(
      planVideo(
        probe,
        const Mp4Layout(majorBrand: 'mp42', moovBeforeMdat: false),
      ),
      isA<Remux>(),
    );
    expect(
      planVideo(
        probe,
        const Mp4Layout(majorBrand: 'qt  ', moovBeforeMdat: true),
      ),
      isA<Remux>(),
    );
    expect(planVideo(probe, null), isA<Remux>());
  });

  test('H.264 でも、音声が AAC でないか、ビットレートが分からなければ符号化し直す', () {
    const opus = VideoProbe(
      width: 1280,
      height: 720,
      frameRate: 30,
      videoBitrate: 2000000,
      videoCodec: 'h264',
      audioCodec: 'opus',
    );
    expect((planVideo(opus, _mp4) as Transcode).videoBitrate, 2000000);
    const unknown = VideoProbe(width: 1280, height: 720, videoCodec: 'h264');
    expect((planVideo(unknown, _mp4) as Transcode).videoBitrate, 2764800);
    // 音声が無いものはそのまま送れる
    const silent = VideoProbe(
      width: 1280,
      height: 720,
      frameRate: 30,
      videoBitrate: 2000000,
      videoCodec: 'h264',
    );
    expect(planVideo(silent, _mp4), isA<SendAsIs>());
  });

  test('整えた後の大きさを見積もる', () {
    const probe = VideoProbe(
      width: 1920,
      height: 1080,
      durationMs: 60000,
      audioCodec: 'aac',
      audioChannels: 6,
    );
    // 映像 6Mbps + 音声 192kbps(2チャンネルにする)で 60 秒
    expect(estimateTranscodedBytes(probe, 6000000), 46440000);
    expect(
      estimateTranscodedBytes(const VideoProbe(width: 1, height: 1), 1),
      isNull,
    );
  });

  test('VideoProbe はネイティブの値を読む', () {
    final probe = VideoProbe.fromMap({
      'width': 1920,
      'height': 1080,
      'rotation': 270,
      'durationMs': 20000.4,
      'frameRate': 59.94,
      'videoBitrate': 8e6,
      'videoCodec': 'h264',
      'audioCodec': null,
    });
    expect(probe.displaySize, (width: 1080, height: 1920));
    expect(probe.durationMs, 20000);
    expect(probe.videoBitrate, 8000000);
    expect(probe.hasAudio, isFalse);
  });

  group('箱の並び', () {
    late Directory dir;
    setUp(() => dir = Directory.systemTemp.createTempSync('video_plan'));
    tearDown(() => dir.deleteSync(recursive: true));

    Future<Mp4Layout?> layoutOf(List<int> bytes) {
      final file = File('${dir.path}/v.mp4')..writeAsBytesSync(bytes);
      return readMp4Layout(file.path);
    }

    test('moov が mdat の前か後か', () async {
      final first = await layoutOf([
        ...ftyp('isom'),
        ...box('moov', [1, 2, 3]),
        ...box('mdat', List.filled(100, 0)),
      ]);
      expect(first?.majorBrand, 'isom');
      expect(first?.moovBeforeMdat, isTrue);
      final last = await layoutOf([
        ...ftyp('mp42'),
        ...box('free', []),
        ...box('mdat', List.filled(100, 0)),
        ...box('moov', [1, 2, 3]),
      ]);
      expect(last?.moovBeforeMdat, isFalse);
      final mov = await layoutOf([
        ...ftyp('qt  '),
        ...box('wide', []),
        ...box('mdat', []),
      ]);
      expect(mov?.isQuickTime, isTrue);
    });

    test('大きさが 64 ビットの箱を飛ばせる', () async {
      final layout = await layoutOf([
        ...ftyp('isom'),
        // size=1 の後に 64 ビットの大きさ(24 バイト)
        0, 0, 0, 1, ...'free'.codeUnits, 0, 0, 0, 0, 0, 0, 0, 24,
        ...List.filled(8, 0),
        ...box('moov', []),
      ]);
      expect(layout?.moovBeforeMdat, isTrue);
    });

    test('MP4 でないもの、壊れたものは null', () async {
      expect(await layoutOf('not a video at all'.codeUnits), isNull);
      expect(await layoutOf([...ftyp('isom'), 0, 0, 0, 2, 0, 0]), isNull);
      expect(await layoutOf([...ftyp('isom')]), isNull);
    });
  });

  group('DeviceMediaPreparer の動画', () {
    late Directory dir;
    setUp(() => dir = Directory.systemTemp.createTempSync('video_prepare'));
    tearDown(() => dir.deleteSync(recursive: true));

    String writeVideo(List<int> bytes) =>
        (File('${dir.path}/in.mov')..writeAsBytesSync(bytes)).path;

    test('H.264 の MP4 で moov が先頭なら、そのまま送る', () async {
      final path = writeVideo([
        ...ftyp('isom'),
        ...box('moov', []),
        ...box('mdat', List.filled(10, 0)),
      ]);
      final transcoder = FakeTranscoder(
        const VideoProbe(
          width: 1280,
          height: 720,
          rotation: 90,
          durationMs: 1500,
          frameRate: 30,
          videoBitrate: 2000000,
          videoCodec: 'h264',
          audioCodec: 'aac',
        ),
      );
      final media = await DeviceMediaPreparer(transcoder: transcoder)
          .prepare(path);
      expect(transcoder.calls, isEmpty);
      expect(media.path, path);
      expect(media.temporary, isFalse);
      expect(media.contentType, 'video/mp4');
      expect(media.size, (width: 720, height: 1280));
      expect(media.durationMs, 1500);
      expect(media.thumbnail, isNotNull);
    });

    test('HEVC は目標のビットレートで符号化し、整えた後の本体で測る', () async {
      final path = writeVideo([...ftyp('qt  '), ...box('mdat', [])]);
      final transcoder = FakeTranscoder(
        const VideoProbe(
          width: 3840,
          height: 2160,
          rotation: 90,
          durationMs: 20000,
          frameRate: 60,
          videoBitrate: 30000000,
          videoCodec: 'hevc',
          audioCodec: 'aac',
        ),
        output: const VideoProbe(
          width: 3840,
          height: 2160,
          rotation: 90,
          durationMs: 20010,
          videoCodec: 'h264',
        ),
      );
      final progress = <double>[];
      final media = await DeviceMediaPreparer(transcoder: transcoder)
          .prepare(path, onProgress: progress.add);
      expect(transcoder.calls.single.videoBitrate, 30000000);
      expect(media.temporary, isTrue);
      expect(media.path, isNot(path));
      expect(media.size, (width: 2160, height: 3840));
      expect(media.durationMs, 20010);
      expect(progress, [1]);
      File(media.path).deleteSync();
    });

    test('10GB を超えそうなら、符号化する前に止める', () async {
      final path = writeVideo([...ftyp('qt  '), ...box('mdat', [])]);
      final transcoder = FakeTranscoder(
        const VideoProbe(
          width: 3840,
          height: 2160,
          // 37Mbps で 40 分は約 11GB
          durationMs: 40 * 60 * 1000,
          frameRate: 60,
          videoCodec: 'hevc',
          audioCodec: 'aac',
        ),
      );
      await expectLater(
        DeviceMediaPreparer(transcoder: transcoder).prepare(path),
        throwsA(isA<UnsupportedMediaException>()),
      );
      expect(transcoder.calls, isEmpty);
    });
  });
}
