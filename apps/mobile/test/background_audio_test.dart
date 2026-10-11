import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/room/background_audio.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('voiceintercom/in_room');
  final calls = <MethodCall>[];
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  setUp(() {
    calls.clear();
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'start' ? true : null;
    });
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  test('Android では通知の題名を渡してサービスを始め、止める', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    const audio = BackgroundAudio();
    expect(await audio.start('モバイル確認 に入室中'), isTrue);
    await audio.stop();
    expect(calls.map((c) => c.method), ['start', 'stop']);
    expect(calls.first.arguments, {'title': 'モバイル確認 に入室中'});
  });

  test('iOS では何もしない(Info.plist の audio と livekit_client に任せる)', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    const audio = BackgroundAudio();
    expect(await audio.start('x'), isTrue);
    await audio.stop();
    expect(calls, isEmpty);
  });
}
