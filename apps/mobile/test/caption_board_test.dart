import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/room/caption_board.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/caption.pb.dart';

Caption caption(
  String segmentId,
  String text, {
  String language = 'ja',
  bool translated = false,
  bool isFinal = false,
  String messageId = '',
}) => Caption(
  speakerIdentity: 'speaker-1',
  segmentId: segmentId,
  language: language,
  translated: translated,
  text: text,
  isFinal: isFinal,
  utteranceId: 'u1',
  messageId: messageId,
);

void main() {
  test('断片を連結し、確定で置き換える', () {
    final board = CaptionBoard();
    board.apply(caption('s1', 'こん'));
    board.apply(caption('s1', 'にちは'));
    expect(board.segments.single.original!.text, 'こんにちは');
    expect(board.segments.single.original!.isFinal, isFalse);

    board.apply(caption('s1', 'こんにちは。', isFinal: true));
    expect(board.segments.single.original!.text, 'こんにちは。');
    expect(board.segments.single.original!.isFinal, isTrue);
  });

  test('(segment_id, language, translated) ごとに分けて持つ', () {
    final board = CaptionBoard();
    board.apply(caption('s1', 'はい', isFinal: true));
    board.apply(caption('s1', 'Ye', language: 'en', translated: true));
    board.apply(caption('s1', 's', language: 'en', translated: true));
    board.apply(
      caption('s1', '네', language: 'ko', translated: true, isFinal: true),
    );

    final s = board.segments.single;
    expect(s.originalLanguage, 'ja');
    expect(s.original!.text, 'はい');
    expect(s.translations['en']!.text, 'Yes');
    expect(s.translations['ko']!.text, '네');
  });

  test('確定の後に届いた断片は無視する', () {
    final board = CaptionBoard();
    board.apply(caption('s1', '確定', isFinal: true));
    board.apply(caption('s1', '遅れた断片'));
    expect(board.segments.single.original!.text, '確定');
  });

  test('空の確定は字幕を消す', () {
    final board = CaptionBoard();
    board.apply(caption('s1', 'えー'));
    board.apply(caption('s1', '', isFinal: true));
    expect(board.segments, isEmpty);
  });

  test('区切りは届いた順に並び、上限を超えたら古いものから捨てる', () {
    final board = CaptionBoard(maxSegments: 2);
    board.apply(caption('s1', '1', isFinal: true));
    board.apply(caption('s2', '2', isFinal: true));
    board.apply(caption('s3', '3', isFinal: true));
    expect(board.segments.map((s) => s.segmentId), ['s2', 's3']);
  });

  test('テキスト入力の字幕は message_id を持つ', () {
    final board = CaptionBoard();
    board.apply(caption('s1', 'はい', isFinal: true, messageId: 'm1'));
    expect(board.segments.single.isText, isTrue);
    expect(board.segments.single.messageId, 'm1');
  });
}
