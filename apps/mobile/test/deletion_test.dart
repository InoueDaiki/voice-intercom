import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:voice_intercom/room/caption_board.dart';
import 'package:voice_intercom/room/deletion_receiver.dart';
import 'package:voice_intercom/room/media_feed.dart';
import 'package:voice_intercom/room/room_session.dart';
import 'package:voice_intercom/screens/deletion_widgets.dart';
import 'package:voice_intercom_api_client/api.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/caption.pb.dart';

import 'support/deletion_fixtures.dart';
import 'support/media_fixtures.dart';

Caption textCaption(
  String segmentId,
  String text, {
  String speaker = 'alice',
  String messageId = 'm1',
  String language = 'ja',
  bool translated = false,
}) => Caption(
  speakerIdentity: speaker,
  segmentId: segmentId,
  language: language,
  translated: translated,
  text: text,
  isFinal: true,
  messageId: messageId,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('CaptionBoard', () {
    test('消したテキストは本文を捨て、後から届いた訳でも戻さない', () {
      final board = CaptionBoard();
      board.apply(textCaption('s1', 'はい'));
      board.markTextDeleted('alice', 'm1');

      final segment = board.segments.single;
      expect(segment.deleted, isTrue);
      expect(segment.original, isNull);

      // 訳の途中だったものが後から届いても、本文は出さない
      board.apply(textCaption('s1', 'Yes', language: 'en', translated: true));
      expect(board.segments.single.translations, isEmpty);
    });

    test('消した後に初めて届いた字幕も、消したものとして出す', () {
      final board = CaptionBoard();
      board.markTextDeleted('alice', 'm1');
      board.apply(textCaption('s1', 'はい'));

      expect(board.segments.single.deleted, isTrue);
      expect(board.segments.single.original, isNull);
    });

    test('送信者と message_id が両方合うものだけを消す', () {
      final board = CaptionBoard();
      board.apply(textCaption('s1', 'はい', speaker: 'alice'));
      board.apply(textCaption('s2', 'うん', speaker: 'bob'));
      board.markTextDeleted('bob', 'm1');

      expect(board.segments.map((s) => (s.speakerIdentity, s.deleted)), [
        ('alice', false),
        ('bob', true),
      ]);
    });
  });

  group('MediaFeed', () {
    test('墓石で置き換え、消していない行では戻さない', () {
      final feed = MediaFeed();
      final row = mediaEvent('2026-10-13T00:00:01.000Z');
      feed.add(row);

      expect(feed.add(tombstoneOf(row)), isTrue);
      expect(feed.isDeleted(row.eventId), isTrue);
      expect(feed.items.single.media, isNull);

      // 遅れて届いた complete の応答や古い履歴で戻さない
      expect(feed.add(row), isFalse);
      expect(feed.isDeleted(row.eventId), isTrue);
    });

    test('知らない行の墓石も足す(入室時の履歴)', () {
      final feed = MediaFeed();
      final row = mediaEvent('2026-10-13T00:00:01.000Z');

      expect(feed.add(tombstoneOf(row)), isTrue);
      expect(feed.items, hasLength(1));
    });

    test('テキストの墓石は足さない', () {
      final feed = MediaFeed();
      expect(
        feed.add(tombstoneOf(ownText('2026-10-13T00:00:01.000Z'))),
        isFalse,
      );
    });
  });

  group('DeletionReceiver', () {
    test('履歴で消されていれば墓石を渡し、送信元の参加者があるものは捨てる', () async {
      final row = ownText('2026-10-13T00:00:01.000Z');
      final confirmed = <TimelineEvent>[];
      final receiver = DeletionReceiver(
        fetchEvent: (_) async => tombstoneOf(row),
        onConfirmed: confirmed.add,
        isApplied: (_) => false,
      );

      expect(
        receiver.receive(deletionFor(row), fromParticipant: true),
        DeletionReceiveResult.fromParticipant,
      );
      expect(
        receiver.receive(deletionFor(row), fromParticipant: false),
        DeletionReceiveResult.checking,
      );
      expect(
        receiver.receive(deletionFor(row), fromParticipant: false),
        DeletionReceiveResult.duplicate,
      );
      await pumpEventQueue();

      expect(confirmed.single.deleted, isNotNull);
      expect(receiver.pendingCount, 0);
    });

    test('偽の知らせ(履歴では消されていない、行が無い)は捨てる', () async {
      final row = ownText('2026-10-13T00:00:01.000Z');
      final confirmed = <TimelineEvent>[];
      final receiver = DeletionReceiver(
        fetchEvent: (id) async => id == row.eventId ? row : null,
        onConfirmed: confirmed.add,
        isApplied: (_) => false,
      );

      receiver.receive(deletionFor(row), fromParticipant: false);
      receiver.receive(
        deletionFor(ownText('2026-10-13T00:00:02.000Z', sourceId: 'x')),
        fromParticipant: false,
      );
      await pumpEventQueue();

      expect(confirmed, isEmpty);
    });

    test('読めなければ間を置いて読み直す', () async {
      final row = ownText('2026-10-13T00:00:01.000Z');
      var calls = 0;
      final confirmed = <TimelineEvent>[];
      final receiver = DeletionReceiver(
        fetchEvent: (_) async {
          calls++;
          if (calls == 1) {
            throw Exception('通信の失敗');
          }
          return tombstoneOf(row);
        },
        onConfirmed: confirmed.add,
        isApplied: (_) => false,
        retryDelays: const [Duration(milliseconds: 10)],
      );

      receiver.receive(deletionFor(row), fromParticipant: false);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(calls, 2);
      expect(confirmed, hasLength(1));
      receiver.dispose();
    });

    test('読めないもの、event_id が空のものは捨てる', () {
      final receiver = DeletionReceiver(
        fetchEvent: (_) async => null,
        onConfirmed: (_) {},
        isApplied: (_) => false,
      );
      expect(
        receiver.receive([0xff, 0xff], fromParticipant: false),
        DeletionReceiveResult.invalid,
      );
      expect(
        receiver.receive([], fromParticipant: false),
        DeletionReceiveResult.invalid,
      );
    });
  });

  group('RoomSession', () {
    test('topic deletion を確かめて、字幕と画像・動画を「削除された…」にする', () async {
      final text = ownText('2026-10-13T00:00:01.000Z', senderId: 'bob');
      final media = mediaEvent('2026-10-13T00:00:02.000Z', senderId: 'bob');
      final rows = {
        text.eventId: tombstoneOf(text),
        media.eventId: tombstoneOf(media),
      };
      final session = RoomSession(
        myIdentity: 'alice',
        myLanguage: 'ja',
        roomName: 'r',
        fetchTimelineEvent: (id) async => rows[id],
      );
      session.captions.apply(textCaption('s1', 'はい', speaker: 'bob'));
      session.addMedia([media]);

      for (final row in [text, media]) {
        session.handleData(
          DataReceivedEvent(
            participant: null,
            data: deletionFor(row),
            topic: deletionTopic,
          ),
        );
      }
      await pumpEventQueue();

      expect(session.captions.segments.single.deleted, isTrue);
      expect(session.media.isDeleted(media.eventId), isTrue);
    });

    test('入室時の履歴の墓石を反映する', () {
      final session = RoomSession(
        myIdentity: 'alice',
        myLanguage: 'ja',
        roomName: 'r',
      );
      session.captions.apply(textCaption('s1', 'はい'));
      final media = mediaEvent('2026-10-13T00:00:02.000Z');

      session.applyTimeline([
        tombstoneOf(ownText('2026-10-13T00:00:01.000Z')),
        tombstoneOf(media),
      ]);

      expect(session.captions.segments.single.deleted, isTrue);
      expect(session.media.isDeleted(media.eventId), isTrue);
    });

    test('自分のテキストは、履歴に保存されるのを待ってから消す', () async {
      final row = ownText('2026-10-13T00:00:01.000Z');
      var fetches = 0;
      final deleted = <String>[];
      final session = RoomSession(
        myIdentity: 'alice',
        myLanguage: 'ja',
        roomName: 'r',
        fetchRecentTimeline: () async {
          fetches++;
          // 2回目で Agent が保存した
          return fetches < 2 ? [] : [row];
        },
        deleteTimelineEvent: (id) async {
          deleted.add(id);
          return tombstoneOf(row);
        },
        findTextRetryDelays: const [Duration.zero, Duration.zero],
      );
      session.captions.apply(textCaption('s1', 'はい'));
      final segment = session.captions.segments.single;
      expect(session.canDeleteCaption(segment), isTrue);

      await session.deleteOwnText(segment);

      expect(deleted, [row.eventId]);
      expect(session.captions.segments.single.deleted, isTrue);
      expect(session.canDeleteCaption(segment), isFalse);
    });

    test('保存されないままなら NotSavedYetException', () async {
      final session = RoomSession(
        myIdentity: 'alice',
        myLanguage: 'ja',
        roomName: 'r',
        fetchRecentTimeline: () async => [],
        deleteTimelineEvent: (_) async => throw StateError('呼ばれない'),
        findTextRetryDelays: const [Duration.zero],
      );
      session.captions.apply(textCaption('s1', 'はい'));

      await expectLater(
        session.deleteOwnText(session.captions.segments.single),
        throwsA(isA<NotSavedYetException>()),
      );
    });

    test('他人のテキストと画像・動画には消す操作を出さない', () {
      final session = RoomSession(
        myIdentity: 'alice',
        myLanguage: 'ja',
        roomName: 'r',
        fetchRecentTimeline: () async => [],
        deleteTimelineEvent: (_) async => throw StateError('呼ばれない'),
      );
      session.captions.apply(textCaption('s1', 'はい', speaker: 'bob'));
      final mine = mediaEvent('2026-10-13T00:00:02.000Z');

      expect(
        session.canDeleteCaption(session.captions.segments.single),
        isFalse,
      );
      expect(session.canDeleteMedia(mine), isTrue);
      expect(
        session.canDeleteMedia(
          mediaEvent('2026-10-13T00:00:03.000Z', senderId: 'bob'),
        ),
        isFalse,
      );
      expect(session.canDeleteMedia(tombstoneOf(mine)), isFalse);
    });
  });

  group('表示', () {
    test('種類ごとの言い方', () {
      expect(
        deletedLabel(tombstoneOf(ownText('2026-10-13T00:00:01.000Z'))),
        '削除されたテキスト',
      );
      final image = mediaEvent('2026-10-13T00:00:02.000Z');
      expect(deletedLabel(tombstoneOf(image)), '削除された画像');
      expect(deletedLabel(tombstoneOf(image, video: true)), '削除された動画');
      expect(deletionWhat(image), '画像');
      expect(deletionWhat(mediaEvent('t', video: true)), '動画');
    });

    testWidgets('長押しのメニューと確認を経てから消す', (tester) async {
      bool? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () async =>
                  result = await confirmDeletion(context, '画像'),
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('deleteMenu')));
      await tester.pumpAndSettle();
      expect(find.text('画像を削除しますか?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('confirmDelete')));
      await tester.pumpAndSettle();
      expect(result, isTrue);

      // やめたら false
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('deleteMenu')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('やめる'));
      await tester.pumpAndSettle();
      expect(result, isFalse);
    });
  });
}
