import 'package:image_picker/image_picker.dart';

/// どこから選ぶか
enum MediaPickSource {
  /// 写真ライブラリ(画像か動画)
  library,

  /// カメラで写真を撮る
  photo,

  /// カメラで動画を撮る
  video,
}

/// 画像の長い辺の上限。image_picker が縮める
const pickMaxImageSide = 2048.0;

/// JPEG の品質。imageQuality か maxWidth を渡すと、iOS の HEIC も JPEG になる見込み
/// (設計メモの「端末での圧縮」。実機で確かめる)
const pickImageQuality = 85;

/// 画像・動画を選び、ファイルのパスを返す。取りやめたら null。
Future<String?> pickMediaFile(
  MediaPickSource source, {
  ImagePicker? picker,
}) async {
  picker ??= ImagePicker();
  final XFile? file = switch (source) {
    MediaPickSource.library => await picker.pickMedia(
      maxWidth: pickMaxImageSide,
      maxHeight: pickMaxImageSide,
      imageQuality: pickImageQuality,
    ),
    MediaPickSource.photo => await picker.pickImage(
      source: ImageSource.camera,
      maxWidth: pickMaxImageSide,
      maxHeight: pickMaxImageSide,
      imageQuality: pickImageQuality,
    ),
    // 動画の長さには上限を設けない(大きさの上限は整えるときに確かめる)
    MediaPickSource.video => await picker.pickVideo(source: ImageSource.camera),
  };
  return file?.path;
}
