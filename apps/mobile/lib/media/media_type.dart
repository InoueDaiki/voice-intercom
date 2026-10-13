import 'dart:typed_data';

/// 選んだファイルの中身の形式。拡張子や image_picker の mimeType は当てにならない
/// (iOS で HEIC を JPEG にしたのに拡張子が残る、Android で mimeType が null など)ので、
/// 先頭のバイトで見分ける。
enum SniffedType {
  jpeg('image/jpeg'),
  png('image/png'),
  webp('image/webp'),
  heic('image/heic'),
  gif('image/gif'),

  /// MP4 / MOV などの動画。送る前に H.264 の MP4 にする
  video('video/*'),
  unknown('application/octet-stream');

  const SniffedType(this.mime);

  final String mime;

  bool get isImage => this != video && this != unknown;

  /// API がそのまま受け付ける画像(uploads の content_type)
  bool get uploadableAsIs =>
      this == jpeg || this == png || this == webp || this == heic;
}

/// 判定に要る先頭のバイト数
const sniffLength = 16;

/// 先頭のバイトから形式を見分ける。
SniffedType sniffMediaType(Uint8List head) {
  bool at(int offset, List<int> bytes) {
    if (head.length < offset + bytes.length) {
      return false;
    }
    for (var i = 0; i < bytes.length; i++) {
      if (head[offset + i] != bytes[i]) {
        return false;
      }
    }
    return true;
  }

  if (at(0, const [0xFF, 0xD8, 0xFF])) {
    return SniffedType.jpeg;
  }
  if (at(0, const [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) {
    return SniffedType.png;
  }
  if (at(0, 'RIFF'.codeUnits) && at(8, 'WEBP'.codeUnits)) {
    return SniffedType.webp;
  }
  if (at(0, 'GIF8'.codeUnits)) {
    return SniffedType.gif;
  }
  // ISO BMFF(MP4、MOV、HEIC)は 4 バイト目から "ftyp" と主ブランドが続く
  if (at(4, 'ftyp'.codeUnits) && head.length >= 12) {
    final brand = String.fromCharCodes(head.sublist(8, 12));
    if (_heifBrands.contains(brand)) {
      return SniffedType.heic;
    }
    return SniffedType.video;
  }
  // 古い MOV には ftyp がなく、moov / mdat / wide などの箱から始まるものがある
  if (head.length >= 8) {
    final box = String.fromCharCodes(head.sublist(4, 8));
    if (const {'moov', 'mdat', 'wide', 'free', 'skip'}.contains(box)) {
      return SniffedType.video;
    }
  }
  return SniffedType.unknown;
}

// HEIF の静止画のブランド(avif は API が受け付けないので含めない)
const _heifBrands = {'heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'};
