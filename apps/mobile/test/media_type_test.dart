import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/media/media_type.dart';

Uint8List bytes(List<int> head, [String ascii = '']) =>
    Uint8List.fromList([...head, ...ascii.codeUnits]);

/// ISO BMFF の先頭(箱の大きさ + "ftyp" + 主ブランド)
Uint8List ftyp(String brand) =>
    bytes([0, 0, 0, 0x18], 'ftyp$brand\u0000\u0000\u0000\u0000');

void main() {
  test('画像の形式を先頭のバイトで見分ける', () {
    expect(sniffMediaType(bytes([0xFF, 0xD8, 0xFF, 0xE0])), SniffedType.jpeg);
    expect(
      sniffMediaType(bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
      SniffedType.png,
    );
    expect(
      sniffMediaType(bytes([], 'RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')),
      SniffedType.webp,
    );
    expect(sniffMediaType(bytes([], 'GIF89a')), SniffedType.gif);
  });

  test('ftyp のブランドで HEIC と動画を分ける', () {
    expect(sniffMediaType(ftyp('heic')), SniffedType.heic);
    expect(sniffMediaType(ftyp('mif1')), SniffedType.heic);
    expect(sniffMediaType(ftyp('isom')), SniffedType.video);
    expect(sniffMediaType(ftyp('mp42')), SniffedType.video);
    // iPhone の MOV
    expect(sniffMediaType(ftyp('qt  ')), SniffedType.video);
  });

  test('ftyp の無い古い MOV も動画にする', () {
    expect(
      sniffMediaType(bytes([0, 0, 0, 8], 'wide\u0000\u0000\u0000\u0000')),
      SniffedType.video,
    );
  });

  test('分からないものと短すぎるものは unknown', () {
    expect(sniffMediaType(bytes([], '%PDF-1.7')), SniffedType.unknown);
    expect(sniffMediaType(Uint8List(0)), SniffedType.unknown);
    expect(sniffMediaType(bytes([0xFF, 0xD8])), SniffedType.unknown);
  });

  test('API がそのまま受け付ける画像', () {
    expect(SniffedType.jpeg.uploadableAsIs, isTrue);
    expect(SniffedType.heic.uploadableAsIs, isTrue);
    expect(SniffedType.gif.uploadableAsIs, isFalse);
    expect(SniffedType.video.uploadableAsIs, isFalse);
  });
}
