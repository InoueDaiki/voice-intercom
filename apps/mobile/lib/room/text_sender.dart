import 'dart:async';
import 'dart:math';

import 'package:voice_intercom_schema/gen/voiceintercom/v1/text.pb.dart';

/// 送ったテキストの状態。
enum OutgoingTextState {
  /// 自分の message_id の字幕を待っている
  sending,

  /// 自分の message_id の字幕が届いた(Agent が受け付けた)
  delivered,

  /// 送り直しても字幕が届かなかった
  failed,
}

class OutgoingText {
  OutgoingText(this.messageId, this.text);

  final String messageId;
  final String text;
  OutgoingTextState state = OutgoingTextState.sending;
  int attempts = 0;
  Timer? _timer;
}

/// テキスト入力(topic "text" の TextMessage)を送り、届かなければ送り直す。
///
/// 入室の直後(ローカルの LiveKit では約3秒以内)に送ったテキストは、Agent に参加者の情報より先に
/// 届くと、送信元が分からず捨てられる(設計メモの「Agent の結合確認」)。Agent は受け付けたら
/// すぐに原文の字幕(message_id 付き)を配信するので、自分の message_id の字幕が [ackTimeout] の
/// うちに届かなければ、同じ message_id で送り直す。Agent は同じ (identity, message_id) を1回だけ
/// 処理する。
class TextSender {
  TextSender({
    required this.send,
    required this.onChanged,
    this.ackTimeout = const Duration(seconds: 4),
    this.maxAttempts = 3,
    String Function()? newMessageId,
  }) : _newMessageId = newMessageId ?? randomMessageId;

  /// データチャネルに送る。失敗したら例外を投げる(送り直しの対象になる)
  final Future<void> Function(TextMessage message) send;
  final void Function() onChanged;
  final Duration ackTimeout;
  final int maxAttempts;
  final String Function() _newMessageId;
  final Map<String, OutgoingText> _items = {};
  bool _disposed = false;

  /// 送った順のテキスト
  List<OutgoingText> get items => _items.values.toList(growable: false);

  OutgoingText? find(String messageId) => _items[messageId];

  /// テキストを送る。前後の空白を除いて空なら送らない
  OutgoingText? submit(String text) {
    text = text.trim();
    if (text.isEmpty) {
      return null;
    }
    final item = OutgoingText(_newMessageId(), text);
    _items[item.messageId] = item;
    _attempt(item);
    return item;
  }

  /// 自分の送ったテキストの字幕が届いたら呼ぶ
  void acknowledge(String messageId) {
    final item = _items[messageId];
    if (item == null || item.state == OutgoingTextState.delivered) {
      return;
    }
    item._timer?.cancel();
    item.state = OutgoingTextState.delivered;
    onChanged();
  }

  void dispose() {
    _disposed = true;
    for (final item in _items.values) {
      item._timer?.cancel();
    }
  }

  void _attempt(OutgoingText item) {
    item.attempts++;
    item.state = OutgoingTextState.sending;
    onChanged();
    // 送信の失敗も、字幕が届かなかったのと同じく時間切れで送り直す
    unawaited(
      send(TextMessage(messageId: item.messageId, text: item.text))
          .catchError((Object _) {}),
    );
    item._timer = Timer(ackTimeout, () {
      if (_disposed || item.state != OutgoingTextState.sending) {
        return;
      }
      if (item.attempts >= maxAttempts) {
        item.state = OutgoingTextState.failed;
        onChanged();
        return;
      }
      _attempt(item);
    });
  }
}

final _random = Random.secure();

/// 128ビットの乱数の hex(UUID と同じ長さ)
String randomMessageId() {
  final buffer = StringBuffer();
  for (var i = 0; i < 16; i++) {
    buffer.write(_random.nextInt(256).toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}
