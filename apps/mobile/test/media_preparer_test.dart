import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:voice_intercom/media/media_preparer.dart';
import 'package:voice_intercom/media/media_type.dart';

/// 縮めても小さくならないよう、乱数で塗った画像
img.Image noise(int width, int height) {
  final random = Random(1);
  final image = img.Image(width: width, height: height);
  for (final p in image) {
    p
      ..r = random.nextInt(256)
      ..g = random.nextInt(256)
      ..b = random.nextInt(256);
  }
  return image;
}

void main() {
  late Directory dir;

  setUp(() => dir = Directory.systemTemp.createTempSync('media_preparer'));
  tearDown(() => dir.deleteSync(recursive: true));

  String write(String name, List<int> bytes) {
    final file = File('${dir.path}/$name')..writeAsBytesSync(bytes);
    return file.path;
  }

  test('小さい JPEG はそのまま、サムネイルなしで送る', () async {
    final path = write('a.jpg', img.encodeJpg(noise(64, 48)));
    final media = await prepareImage(path, SniffedType.jpeg);
    expect(media.path, path);
    expect(media.contentType, 'image/jpeg');
    expect(media.sizeBytes, File(path).lengthSync());
    expect(media.thumbnail, isNull);
    expect(media.isVideo, isFalse);
    expect(media.temporary, isFalse);
  });

  test('1MB を超える画像にはサムネイル(JPEG、長い辺 480)を作る', () async {
    final png = img.encodePng(noise(900, 600));
    expect(png.length, greaterThan(imageThumbnailThreshold));
    final path = write('big.png', png);
    final media = await prepareImage(path, SniffedType.png);
    expect(media.contentType, 'image/png');
    final thumbnail = media.thumbnail!;
    expect(sniffMediaType(thumbnail), SniffedType.jpeg);
    final decoded = img.decodeJpg(thumbnail)!;
    expect(decoded.width, thumbnailMaxSide);
    expect(decoded.height, 320);
  });

  test('HEIC はこのアプリで読めないので、サムネイルなしでそのまま送る', () async {
    final head = [0, 0, 0, 0x18, ...'ftypheic'.codeUnits];
    final path = write(
      'a.heic',
      Uint8List(imageThumbnailThreshold + 10)..setAll(0, head),
    );
    final media = await prepareImage(path, SniffedType.heic);
    expect(media.contentType, 'image/heic');
    expect(media.thumbnail, isNull);
  });

  test('GIF は JPEG にして送る', () async {
    final path = write('a.gif', img.encodeGif(noise(40, 30)));
    final media = await prepareImage(path, SniffedType.gif);
    expect(media.contentType, 'image/jpeg');
    expect(media.temporary, isTrue);
    expect(media.path, isNot(path));
    final out = File(media.path).readAsBytesSync();
    expect(sniffMediaType(out), SniffedType.jpeg);
    expect(media.sizeBytes, out.length);
    await deleteTemporary(media);
    expect(File(media.path).existsSync(), isFalse);
  });

  test('読めない画像は送れない(やり直させない)', () async {
    final path = write('broken.gif', 'GIF89a broken'.codeUnits);
    expect(
      prepareImage(path, SniffedType.gif),
      throwsA(isA<UnsupportedMediaException>()),
    );
  });

  test('形式の分からないファイルは送れない', () async {
    final path = write('a.pdf', '%PDF-1.7 0123456789'.codeUnits);
    expect(
      const DeviceMediaPreparer().prepare(path),
      throwsA(isA<UnsupportedMediaException>()),
    );
  });

  test('縦長の画像のサムネイルは高さを 480 にする', () {
    final thumbnail = makeThumbnail(img.encodeJpg(noise(300, 960)))!;
    final decoded = img.decodeJpg(thumbnail)!;
    expect(decoded.height, thumbnailMaxSide);
    expect(decoded.width, 150);
  });

  test('小さい画像のサムネイルは拡大しない', () {
    final decoded = img.decodeJpg(
      makeThumbnail(img.encodePng(noise(100, 80)))!,
    )!;
    expect((decoded.width, decoded.height), (100, 80));
  });
}
