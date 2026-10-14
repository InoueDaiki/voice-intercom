import 'dart:async';
import 'dart:math';

import 'package:voice_intercom_schema/gen/voiceintercom/v1/text.pb.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/text_status.pb.dart';

/// 送ったテキストの状態。
enum OutgoingTextState {
  /// 自分の message_id の字幕を待っている
  sending,

  /// Agent が受け付けた(TextStatus の ACCEPTED か COMPLETED、または自分の message_id の字幕が届いた)
  delivered,

  /// Agent が断った(長すぎる、など。TextStatus の REJECTED)
  rejected,

  /// 受け付けたが、翻訳か読み上げの一部に失敗した(TextStatus の FAILED)
  processingFailed,

  /// 送り直しても字幕も TextStatus も届かなかった
  failed,
}

class OutgoingText {
  OutgoingText(this.messageId, this.text);

  final String messageId;
  final String text;
  OutgoingTextState state = OutgoingTextState.sending;
  int attempts = 0;

  /// 最後に届いた TextStatus(TextStatus を送らない古い Agent なら null のまま)
  TextStatus? status;

  /// Agent が受け付けて(ACCEPTED)、まだ結果(COMPLETED か FAILED)が届いていない
  bool get processing =>
      state == OutgoingTextState.delivered &&
      status?.state == TextStatus_State.STATE_ACCEPTED;
  Timer? _timer;
  // 送る順番は来たが、[TextSender.canSend] が偽で送らずにいる
  bool _waiting = false;
}

/// テキスト入力(topic "text" の TextMessage)を送り、届かなければ送り直す。
///
/// 入室の直後(ローカルの LiveKit では約3秒以内)に送ったテキストは、Agent に参加者の情報より先に
/// 届くと、送信元が分からず捨てられる(設計メモの「Agent の結合確認」)。Agent は受け付けたら
/// すぐに原文の字幕(message_id 付き)を配信するので、自分の message_id の字幕が [ackTimeout] の
/// うちに届かなければ、同じ message_id で送り直す。Agent は同じ (identity, message_id) を1回だけ
/// 処理する。
///
/// 受け手のアプリは、送信元が Agent の参加者の字幕しか読まない(RoomSession)。Agent が後から
/// 入ったルームでは、アプリが Agent を知るまでの約3秒に届いた字幕は捨てられ、送り直しも Agent が
/// 重複として捨てるので、字幕が返ってこない。そこで [canSend] が偽(Agent をまだ知らない)の間は
/// 送らずに待ち、[resume] で送る。待つ間も送ったものとして数え、上限で諦める(Agent がいない)。
///
/// Agent は受け付け・断り・結果を TextStatus(topic "text_status")で送信者だけに送る([applyStatus])。
/// 字幕と TextStatus のどちらが届いても送り直しを止める(TextStatus を送らない古い Agent でも止まる)。
/// 送り直しが Agent に届けば、Agent は処理をやり直さずに字幕と TextStatus を送り直すので、最初の
/// 字幕を捨てていても止まる。
class TextSender {
  TextSender({
    required this.send,
    required this.onChanged,
    this.ackTimeout = const Duration(seconds: 4),
    this.maxAttempts = 3,
    bool Function()? canSend,
    String Function()? newMessageId,
  }) : canSend = canSend ?? _always,
       _newMessageId = newMessageId ?? randomMessageId;

  /// データチャネルに送る。失敗したら例外を投げる(送り直しの対象になる)
  final Future<void> Function(TextMessage message) send;
  final void Function() onChanged;
  final Duration ackTimeout;
  final int maxAttempts;

  /// 今送ってよいか。偽なら送らずに待つ([resume] で送る)
  final bool Function() canSend;
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
    if (item == null) {
      return;
    }
    _settle(item, OutgoingTextState.delivered);
  }

  /// Agent から自分の送ったテキストの TextStatus が届いたら呼ぶ
  void applyStatus(TextStatus status) {
    final item = _items[status.messageId];
    if (item == null) {
      return;
    }
    final next = switch (status.state) {
      TextStatus_State.STATE_ACCEPTED ||
      TextStatus_State.STATE_COMPLETED => OutgoingTextState.delivered,
      TextStatus_State.STATE_REJECTED => OutgoingTextState.rejected,
      TextStatus_State.STATE_FAILED => OutgoingTextState.processingFailed,
      _ => null,
    };
    if (next == null) {
      return;
    }
    // 結果が出た後に、送り直しへの ACCEPTED が遅れて届いても戻さない
    final settled =
        item.state == OutgoingTextState.rejected ||
        item.state == OutgoingTextState.processingFailed ||
        _isFinal(item.status);
    if (settled && !_isFinal(status)) {
      return;
    }
    item.status = status;
    _settle(item, next, force: true);
  }

  static bool _isFinal(TextStatus? s) =>
      s != null && s.state != TextStatus_State.STATE_ACCEPTED;

  void _settle(
    OutgoingText item,
    OutgoingTextState next, {
    bool force = false,
  }) {
    // 断られた・失敗したものは、字幕が届いても「届いた」に戻さない
    final keep =
        item.state == OutgoingTextState.rejected ||
        item.state == OutgoingTextState.processingFailed;
    if (!force && (keep || item.state == next)) {
      return;
    }
    item._timer?.cancel();
    item._waiting = false;
    item.state = next;
    onChanged();
  }

  /// [canSend] が真になったら呼ぶ。待っていたものをすぐ送り、そこから [ackTimeout] を数え直す
  void resume() {
    if (_disposed || !canSend()) {
      return;
    }
    for (final item in _items.values) {
      if (item._waiting && item.state == OutgoingTextState.sending) {
        item._timer?.cancel();
        _send(item);
      }
    }
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
    if (canSend()) {
      _send(item);
    } else {
      item._waiting = true;
      _startTimer(item);
    }
  }

  void _send(OutgoingText item) {
    item._waiting = false;
    // 送信の失敗も、字幕が届かなかったのと同じく時間切れで送り直す
    unawaited(
      send(TextMessage(messageId: item.messageId, text: item.text))
          .catchError((Object _) {}),
    );
    _startTimer(item);
  }

  void _startTimer(OutgoingText item) {
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

bool _always() => true;

final _random = Random.secure();

/// 128ビットの乱数の hex(UUID と同じ長さ)
String randomMessageId() {
  final buffer = StringBuffer();
  for (var i = 0; i < 16; i++) {
    buffer.write(_random.nextInt(256).toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}

/// 送ったテキストの状態の表示。表示しないもの(届いて処理を終えた)は null
String? outgoingTextLabel(OutgoingText t) {
  switch (t.state) {
    case OutgoingTextState.sending:
      return '送信中(${t.attempts}回目)';
    case OutgoingTextState.delivered:
      // 結果を待っている間だけ出す。結果を送らない古い Agent では、字幕が届いたら消す
      return t.processing ? '届いた' : null;
    case OutgoingTextState.rejected:
      return '断られた(${_rejectReason(t.status)})';
    case OutgoingTextState.processingFailed:
      return '失敗した(${_failure(t.status)})';
    case OutgoingTextState.failed:
      return '届かなかった';
  }
}

String _rejectReason(TextStatus? s) {
  switch (s?.reason) {
    case TextStatus_Reason.REASON_EMPTY:
      return '空のテキスト';
    case TextStatus_Reason.REASON_TOO_LONG:
      final max = s?.maxChars ?? 0;
      return max > 0 ? '長すぎる。$max文字まで' : '長すぎる';
    default:
      return '理由不明';
  }
}

String _failure(TextStatus? s) {
  final parts = [
    if (s != null && s.untranslatedLanguages.isNotEmpty)
      '訳せなかった: ${s.untranslatedLanguages.join(', ')}',
    if (s != null && s.unspokenLanguages.isNotEmpty)
      '読み上げられなかった: ${s.unspokenLanguages.join(', ')}',
  ];
  return parts.isEmpty ? '理由不明' : parts.join('、');
}
