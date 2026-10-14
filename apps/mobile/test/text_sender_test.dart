import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/room/text_sender.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/text.pb.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/text_status.pb.dart';

void main() {
  late List<TextMessage> sent;
  late TextSender sender;

  TextSender make({bool failSend = false, bool Function()? canSend}) {
    var n = 0;
    return TextSender(
      canSend: canSend,
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

  test('送ってよくなるまで待ち、resume ですぐ送る', () {
    fakeAsync((async) {
      var agentKnown = false;
      sender = make(canSend: () => agentKnown);
      final item = sender.submit('はい')!;
      async.elapse(const Duration(seconds: 3));
      expect(sent, isEmpty);
      expect(item.state, OutgoingTextState.sending);

      // まだ送れないうちの resume は何もしない
      sender.resume();
      async.flushMicrotasks();
      expect(sent, isEmpty);

      agentKnown = true;
      sender.resume();
      async.flushMicrotasks();
      expect(sent.single.messageId, 'm1');

      // 待ちの時間切れ(4秒)ではなく、送ったときから数え直す
      async.elapse(const Duration(seconds: 3));
      expect(sent, hasLength(1));
      sender.acknowledge('m1');
      async.elapse(const Duration(seconds: 20));
      expect(sent, hasLength(1));
      expect(item.state, OutgoingTextState.delivered);
    });
  });

  test('送ってよくならないまま上限まで待てば諦める', () {
    fakeAsync((async) {
      sender = make(canSend: () => false);
      final item = sender.submit('はい')!;
      async.elapse(const Duration(seconds: 12));
      expect(sent, isEmpty);
      expect(item.state, OutgoingTextState.failed);
    });
  });

  test('待っている間の時間切れの後に送れるようになれば、次の回で送る', () {
    fakeAsync((async) {
      var agentKnown = false;
      sender = make(canSend: () => agentKnown);
      sender.submit('はい');
      async.elapse(const Duration(seconds: 2));
      agentKnown = true;
      // resume を呼ばなくても、時間切れの送り直しで送る
      async.elapse(const Duration(seconds: 2));
      expect(sent.single.messageId, 'm1');
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

  TextStatus status(
    TextStatus_State state, {
    String id = 'm1',
    TextStatus_Reason? reason,
    int maxChars = 0,
    List<String> untranslated = const [],
    List<String> unspoken = const [],
  }) => TextStatus(
    messageId: id,
    state: state,
    reason: reason,
    maxChars: maxChars,
    untranslatedLanguages: untranslated,
    unspokenLanguages: unspoken,
  );

  test('ACCEPTED で送り直しを止め、結果が届くまで「届いた」と出す', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('はい')!;
      expect(outgoingTextLabel(item), '送信中(1回目)');
      sender.applyStatus(status(TextStatus_State.STATE_ACCEPTED));
      async.elapse(const Duration(seconds: 20));
      expect(sent, hasLength(1));
      expect(item.state, OutgoingTextState.delivered);
      expect(outgoingTextLabel(item), '届いた');
      // 字幕が届いても、結果が届くまでは出したまま
      sender.acknowledge('m1');
      expect(outgoingTextLabel(item), '届いた');

      sender.applyStatus(status(TextStatus_State.STATE_COMPLETED));
      expect(item.state, OutgoingTextState.delivered);
      expect(outgoingTextLabel(item), isNull);
    });
  });

  test('TextStatus を送らない Agent では、字幕が届いたら表示から消す', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('はい')!;
      sender.acknowledge('m1');
      expect(outgoingTextLabel(item), isNull);
    });
  });

  test('断られたら送り直さず、理由を出す', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('長い')!;
      sender.applyStatus(
        status(
          TextStatus_State.STATE_REJECTED,
          reason: TextStatus_Reason.REASON_TOO_LONG,
          maxChars: 500,
        ),
      );
      async.elapse(const Duration(seconds: 20));
      expect(sent, hasLength(1));
      expect(item.state, OutgoingTextState.rejected);
      expect(outgoingTextLabel(item), '断られた(長すぎる。500文字まで)');
      // 送り直しへの応答が遅れて届いても戻さない
      sender.acknowledge('m1');
      sender.applyStatus(status(TextStatus_State.STATE_ACCEPTED));
      expect(item.state, OutgoingTextState.rejected);
    });
  });

  test('翻訳や読み上げに失敗したら「失敗した」と言語を出す', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('はい')!;
      sender.applyStatus(status(TextStatus_State.STATE_ACCEPTED));
      sender.applyStatus(
        status(
          TextStatus_State.STATE_FAILED,
          untranslated: ['ko'],
          unspoken: ['en', 'ja'],
        ),
      );
      expect(item.state, OutgoingTextState.processingFailed);
      expect(outgoingTextLabel(item), '失敗した(訳せなかった: ko、読み上げられなかった: en, ja)');
      // 送り直しへの ACCEPTED が後から届いても戻さない
      sender.applyStatus(status(TextStatus_State.STATE_ACCEPTED));
      expect(item.state, OutgoingTextState.processingFailed);
    });
  });

  test('「届かなかった」の後に結果が届けば、それに直す', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('はい')!;
      async.elapse(const Duration(seconds: 12));
      expect(outgoingTextLabel(item), '届かなかった');
      sender.applyStatus(status(TextStatus_State.STATE_COMPLETED));
      expect(item.state, OutgoingTextState.delivered);
      expect(outgoingTextLabel(item), isNull);
    });
  });

  test('知らない message_id の TextStatus は無視する', () {
    fakeAsync((async) {
      sender = make();
      final item = sender.submit('はい')!;
      sender.applyStatus(status(TextStatus_State.STATE_REJECTED, id: 'other'));
      expect(item.state, OutgoingTextState.sending);
    });
  });

  test('message_id は 32 文字の hex', () {
    expect(randomMessageId(), matches(RegExp(r'^[0-9a-f]{32}$')));
    expect(randomMessageId(), isNot(randomMessageId()));
  });
}
