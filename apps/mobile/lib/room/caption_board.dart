import 'package:voice_intercom_schema/gen/voiceintercom/v1/caption.pb.dart';

/// 1つの言語の字幕の文。断片を連結し、確定が届いたら全文で置き換える。
class CaptionText {
  CaptionText(this.text, {required this.isFinal});

  String text;
  bool isFinal;
}

/// 字幕の区切り(segment_id)1つ分。原文と各言語の訳をまとめて持つ。
class CaptionSegment {
  CaptionSegment({
    required this.segmentId,
    required this.speakerIdentity,
    required this.utteranceId,
    required this.segmentIndex,
    required this.messageId,
    required this.receivedAt,
  });

  final String segmentId;
  final String speakerIdentity;
  // 発話の単位。空なら segment_id が1つの発話にあたる(caption.proto)
  final String utteranceId;
  final int segmentIndex;
  // テキスト入力の字幕なら、送信者のアプリが振った message_id。音声の字幕なら空
  final String messageId;
  // 最初の字幕が届いた時刻。表示の並びに使う
  final DateTime receivedAt;

  // 原文の言語。分からなければ空
  String originalLanguage = '';
  CaptionText? original;
  // 言語コード → 訳
  final Map<String, CaptionText> translations = {};

  bool get isText => messageId.isNotEmpty;

  /// 送った本人が消したテキスト。本文と訳は捨て、「削除されたテキスト」と出す
  bool deleted = false;

  bool get isEmpty =>
      !deleted &&
      (original?.text.isEmpty ?? true) &&
      translations.values.every((t) => t.text.isEmpty);

  void _delete() {
    deleted = true;
    original = null;
    translations.clear();
  }
}

/// データチャネル(topic "caption")で届く Caption を、表示する字幕にまとめる。
///
/// caption.proto の取り決め: (segment_id, language, translated) ごとに断片(is_final が false)を
/// 連結して途中の字幕にし、確定(is_final が true)が届いたらその text で置き換える。
/// 確定は最後に1回だけ届き、空なら字幕を消す。
class CaptionBoard {
  CaptionBoard({this.maxSegments = 200, DateTime Function()? now})
    : _now = now ?? DateTime.now;

  /// 持っておく区切りの上限。古いものから捨てる(過去の発言は履歴の画面で見る)
  final int maxSegments;
  final DateTime Function() _now;
  final Map<String, CaptionSegment> _segments = {};

  // 消したテキスト(送信者の identity と message_id)。後から届いた字幕(訳の途中など)で
  // 消したものを戻さないために持つ
  final Set<(String, String)> _deleted = {};

  /// 届いた順の区切り。空になったもの(確定が空)は除く
  List<CaptionSegment> get segments =>
      _segments.values.where((s) => !s.isEmpty).toList(growable: false);

  /// テキスト入力を消したことにする(履歴で確かめた墓石から呼ぶ)。表示している字幕は
  /// 「削除されたテキスト」になり、この後に届く字幕も本文を出さない。音声の字幕には使わない
  void markTextDeleted(String senderIdentity, String messageId) {
    if (messageId.isEmpty) {
      return;
    }
    _deleted.add((senderIdentity, messageId));
    for (final s in _segments.values) {
      if (s.speakerIdentity == senderIdentity && s.messageId == messageId) {
        s._delete();
      }
    }
  }

  void apply(Caption caption) {
    if (caption.segmentId.isEmpty) {
      return;
    }
    final segment = _segments.putIfAbsent(caption.segmentId, () {
      final created = CaptionSegment(
        segmentId: caption.segmentId,
        speakerIdentity: caption.speakerIdentity,
        utteranceId: caption.utteranceId,
        segmentIndex: caption.segmentIndex,
        messageId: caption.messageId,
        receivedAt: _now(),
      );
      if (caption.messageId.isNotEmpty &&
          _deleted.contains((caption.speakerIdentity, caption.messageId))) {
        created._delete();
      }
      return created;
    });
    if (segment.deleted) {
      return;
    }
    final CaptionText? current;
    if (caption.translated) {
      current = segment.translations[caption.language];
    } else {
      if (caption.language.isNotEmpty) {
        segment.originalLanguage = caption.language;
      }
      current = segment.original;
    }
    final CaptionText next;
    if (current == null) {
      next = CaptionText(caption.text, isFinal: caption.isFinal);
    } else if (current.isFinal) {
      // 確定の後に届いたものは取り決めの外なので、確定を保つ
      return;
    } else if (caption.isFinal) {
      next = current
        ..text = caption.text
        ..isFinal = true;
    } else {
      next = current..text = current.text + caption.text;
    }
    if (caption.translated) {
      segment.translations[caption.language] = next;
    } else {
      segment.original = next;
    }
    while (_segments.length > maxSegments) {
      _segments.remove(_segments.keys.first);
    }
  }
}
