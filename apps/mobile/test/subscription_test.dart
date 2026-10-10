import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/room/subscription.dart';

bool subscribe({
  bool isAudio = true,
  bool fromAgent = false,
  bool isMicrophone = true,
  String trackName = '',
}) => shouldSubscribe(
  isAudio: isAudio,
  fromAgent: fromAgent,
  isMicrophone: isMicrophone,
  trackName: trackName,
  myLanguage: 'ja',
);

void main() {
  test('話者のマイクのトラックを購読する', () {
    expect(subscribe(), isTrue);
    expect(subscribe(isMicrophone: false), isFalse);
    expect(subscribe(isAudio: false), isFalse);
  });

  test('Agent のトラックは自分の言語の翻訳音声だけ', () {
    expect(
      subscribe(
        fromAgent: true,
        isMicrophone: false,
        trackName: 'translation-ja',
      ),
      isTrue,
    );
    expect(
      subscribe(
        fromAgent: true,
        isMicrophone: false,
        trackName: 'translation-en',
      ),
      isFalse,
    );
    expect(subscribe(fromAgent: true, trackName: 'mic'), isFalse);
  });
}
