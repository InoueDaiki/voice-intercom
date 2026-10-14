// 動画を送る形に整える(DeviceMediaPreparer)ところだけを、端末の符号化器で通す。入室しないので、
// ローカルの環境も要らない(iOS シミュレーターの入室で音声が落ちる問題に当たらない)。README の「動画の整え方」を参照。
//
// --dart-define=VIDEO_INPUTS=<端末から読めるパス>,... に元の動画を渡す。
// --dart-define=VIDEO_OUT_DIR=<端末から書けるディレクトリ> を渡すと、整えた本体とサムネイルを写す。
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:voice_intercom/media/media_preparer.dart';
import 'package:voice_intercom/media/video_plan.dart';
import 'package:voice_intercom/media/video_transcoder.dart';

const _inputs = String.fromEnvironment('VIDEO_INPUTS');
const _outDir = String.fromEnvironment('VIDEO_OUT_DIR');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  for (final input in _inputs.split(',').where((p) => p.isNotEmpty)) {
    final name = input.split('/').last;
    testWidgets('$name を整える', (tester) async {
      const transcoder = VideoTranscoder();
      await tester.runAsync(() async {
        final source = await transcoder.probe(input);
        final plan = planVideo(source, await readMp4Layout(input));
        final progress = <double>[];
        final watch = Stopwatch()..start();
        final media = await const DeviceMediaPreparer().prepare(
          input,
          onProgress: progress.add,
        );
        watch.stop();
        final out = media.temporary ? await transcoder.probe(media.path) : null;
        final layout = await readMp4Layout(media.path);
        final bitrate = media.durationMs == null
            ? null
            : (media.sizeBytes * 8 / media.durationMs! / 1000).toStringAsFixed(
                2,
              );
        // ignore: avoid_print
        print(
          'VIDEO_PREPARE: $name '
          'plan=${switch (plan) {
            SendAsIs() => 'as-is',
            Remux() => 'remux',
            Transcode(:final videoBitrate) => 'transcode(${(videoBitrate / 1e6).toStringAsFixed(2)}Mbps)',
          }} '
          'source=${source.width}x${source.height} rot=${source.rotation} '
          'fps=${source.frameRate?.toStringAsFixed(2)} '
          'vbitrate=${((source.videoBitrate ?? 0) / 1e6).toStringAsFixed(2)}Mbps '
          'codec=${source.videoCodec}/${source.audioCodec} -> '
          'out=${out == null ? 'same' : '${out.width}x${out.height} rot=${out.rotation} fps=${out.frameRate?.toStringAsFixed(2)} vbitrate=${((out.videoBitrate ?? 0) / 1e6).toStringAsFixed(2)}Mbps codec=${out.videoCodec}/${out.audioCodec}'} '
          'display=${media.width}x${media.height} '
          'size=${(media.sizeBytes / 1e6).toStringAsFixed(2)}MB total=${bitrate}Mbps '
          'duration=${media.durationMs}ms '
          'moovFirst=${layout?.moovBeforeMdat} brand=${layout?.majorBrand} '
          'thumbnail=${media.thumbnail?.length}B '
          'progress=${progress.length}(${progress.isEmpty ? '' : '${progress.first.toStringAsFixed(2)}..${progress.last.toStringAsFixed(2)}'}) '
          'time=${watch.elapsedMilliseconds}ms',
        );
        expect(media.contentType, 'video/mp4');
        expect(layout?.moovBeforeMdat, isTrue);
        expect(layout?.isQuickTime, isFalse);
        expect(media.thumbnail, isNotNull);
        if (_outDir.isNotEmpty) {
          await File(media.path).copy('$_outDir/$name.out.mp4');
          await File('$_outDir/$name.thumb.jpg').writeAsBytes(media.thumbnail!);
        }
        await deleteTemporary(media);
      });
    }, timeout: const Timeout(Duration(minutes: 30)));
  }
}
