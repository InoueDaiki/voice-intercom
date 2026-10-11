import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// 入室している間、アプリがバックグラウンドにいても音声(送信と受信)を保つ
/// (設計メモの「バックグラウンドでの音声」)。
///
/// - Android: フォアグラウンドサービス(`InRoomService`)を動かし、入室中の通知を出す。
///   Android 14 以降はバックグラウンドからマイクのサービスを新しく始められないので、
///   入室の時点(フォアグラウンド)で [start] する。
/// - iOS: `UIBackgroundModes` の `audio`(Info.plist)だけでよい。オーディオセッションは
///   livekit_client(`AudioManager`)が持ち、マイクを publish している間は playAndRecord で有効にしておく。
///   ここでは何もしない。
class BackgroundAudio {
  const BackgroundAudio();

  static const _channel = MethodChannel('voiceintercom/in_room');

  bool get _supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  /// 始める。[title] は通知に出す。マイクを含めて始めたら true、受信だけなら false。
  /// 何もしない環境では true。OS が許さないとき(バックグラウンドからなど)は例外を投げる。
  Future<bool> start(String title) async {
    if (!_supported) {
      return true;
    }
    return await _channel.invokeMethod<bool>('start', {'title': title}) ??
        false;
  }

  /// 止める。動いていなくてもよい。
  Future<void> stop() async {
    if (!_supported) {
      return;
    }
    await _channel.invokeMethod<void>('stop');
  }
}
