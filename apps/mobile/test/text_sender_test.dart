import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/room/text_sender.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/text.pb.dart';

void main() {
  late List<TextMessage> sent;
  late TextSender sender;

  TextSender make({bool failSend = false}) {
    var n = 0;
    return TextSender(
      send: (m) async {
        sent.add(m);
        if (failSend) {
          throw StateError('送れない');
        }
      },
      onChanged: () {},
      newMessageId: () => 'm${++n}',
    );
  }

  setUp(() => sent = []);

  test('字幕が届けば送り直さない', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('  はい  ')!;
      async.flushMicrotasks();
      expect(sent.single, TextMessage(messageId: 'm1', text: 'はい'));

      sender.acknowledge('m1');
      async.elapse(const Duration(seconds: 20));
      expect(sent, hasLength(1));
      expect(item.state, OutgoingTextState.delivered);
    });
  });

  test('字幕が届かなければ同じ message_id で送り直し、上限で諦める', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('はい')!;
      async.elapse(const Duration(seconds: 4));
      expect(sent.map((m) => m.messageId), ['m1', 'm1']);
      expect(item.state, OutgoingTextState.sending);

      async.elapse(const Duration(seconds: 4));
      expect(sent, hasLength(3));
      async.elapse(const Duration(seconds: 4));
      expect(sent, hasLength(3));
      expect(item.state, OutgoingTextState.failed);
    });
  });

  test('送り直した後に字幕が届けば、そこで止める', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('はい')!;
      async.elapse(const Duration(seconds: 5));
      sender.acknowledge('m1');
      async.elapse(const Duration(seconds: 20));
      expect(sent, hasLength(2));
      expect(item.state, OutgoingTextState.delivered);
    });
  });

  test('送信に失敗しても送り直す', () {
    fakeAsync((async) {
      sender = make(failSend: true);
      sender.submit('はい');
      async.elapse(const Duration(seconds: 4));
      expect(sent, hasLength(2));
    });
  });

  test('空のテキストは送らない', () {
    fakeAsync((async) {
      sender = make();
      expect(sender.submit('   '), isNull);
      async.flushMicrotasks();
      expect(sent, isEmpty);
    });
  });

  test('知らない message_id の字幕は無視する', () {
    fakeAsync((async) {
      sender = make();
      sender.acknowledge('other');
      expect(sender.items, isEmpty);
    });
  });

  test('message_id は 32 文字の hex', () {
    expect(randomMessageId(), matches(RegExp(r'^[0-9a-f]{32}$')));
    expect(randomMessageId(), isNot(randomMessageId()));
  });
}
