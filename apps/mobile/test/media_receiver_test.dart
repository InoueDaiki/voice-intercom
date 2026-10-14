import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:fixnum/fixnum.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/room/media_feed.dart';
import 'package:voice_intercom/room/media_receiver.dart';
import 'package:voice_intercom_api_client/api.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/media.pb.dart';

import 'support/media_fixtures.dart';

/// 履歴の行と同じ中身の MediaMessage(API が送るもの)
List<int> messageFor(TimelineEvent e) => MediaMessage(
  eventId: e.eventId,
  senderIdentity: e.senderId,
  occurredAt: e.occurredAt,
  mediaId: e.media!.mediaId,
  contentType: e.media!.contentType.toJson(),
  url: e.media!.url,
  thumbnailUrl: e.media!.thumbnailUrl ?? '',
  sizeBytes: Int64(e.media!.sizeBytes),
  width: e.media!.width ?? 0,
  height: e.media!.height ?? 0,
  durationMs: e.media!.durationMs ?? 0,
).writeToBuffer();

/// 履歴の代わり。rows を返し、呼ばれた回数を数える
class FakeTimeline {
  List<TimelineEvent> rows = [];
  int calls = 0;
  Completer<void>? gate;
  Object? error;

  Future<List<TimelineEvent>> fetch() async {
    calls++;
    final g = gate;
    if (g != null) {
      await g.future;
    }
    final e = error;
    if (e != null) {
      throw e;
    }
    return List.of(rows);
  }
}

void main() {
  late FakeTimeline timeline;
  late MediaFeed feed;
  late MediaReceiver receiver;

  void setUpReceiver() {
    timeline = FakeTimeline();
    feed = MediaFeed();
    receiver = MediaReceiver(
      fetchRecent: timeline.fetch,
      onConfirmed: feed.addAll,
      isKnown: feed.contains,
    );
  }

  setUp(setUpReceiver);

  test('送信元の参加者があるものは、履歴を読まずに捨てる', () {
    fakeAsync((async) {
      final row = mediaEvent('2026-10-13T00:00:01.000Z');
      timeline.rows = [row];
      expect(
        receiver.receive(messageFor(row), fromParticipant: true),
        MediaReceiveResult.fromParticipant,
      );
      async.flushMicrotasks();
      expect(timeline.calls, 0);
      expect(feed.items, isEmpty);
    });
  });

  test('履歴に行があれば、履歴の行を出す', () {
    fakeAsync((async) {
      final row = mediaEvent(
        '2026-10-13T00:00:01.000Z',
        senderId: 'bob',
        video: true,
        width: 720,
        height: 1280,
        durationMs: 15500,
      );
      timeline.rows = [textEvent('2026-10-13T00:00:02.000Z'), row];
      expect(
        receiver.receive(messageFor(row), fromParticipant: false),
        MediaReceiveResult.checking,
      );
      async.flushMicrotasks();
      expect(timeline.calls, 1);
      expect(feed.items, hasLength(1));
      // 幅・高さ・長さも履歴の行のもの
      expect(feed.items.single.media!.width, 720);
      expect(feed.items.single.media!.durationMs, 15500);
      expect(feed.items.single.senderId, 'bob');
      expect(receiver.pendingCount, 0);
    });
  });

  test('中身は履歴の行で置き換える(偽った URL や送信者は出さない)', () {
    fakeAsync((async) {
      final row = mediaEvent('2026-10-13T00:00:01.000Z', senderId: 'bob');
      timeline.rows = [row];
      final forged = MediaMessage.fromBuffer(messageFor(row))
        ..url = 'https://evil.example/x.jpg'
        ..senderIdentity = 'carol';
      receiver.receive(forged.writeToBuffer(), fromParticipant: false);
      async.flushMicrotasks();
      expect(feed.items.single.media!.url, row.media!.url);
      expect(feed.items.single.senderId, 'bob');
    });
  });

  test('履歴に無ければ読み直し、それでも無ければ捨てる', () {
    fakeAsync((async) {
      final row = mediaEvent('2026-10-13T00:00:01.000Z');
      receiver.receive(messageFor(row), fromParticipant: false);
      async.flushMicrotasks();
      expect(timeline.calls, 1);
      async.elapse(const Duration(seconds: 1));
      expect(timeline.calls, 2);
      async.elapse(const Duration(seconds: 3));
      expect(timeline.calls, 3);
      async.elapse(const Duration(seconds: 10));
      expect(timeline.calls, 3);
      expect(feed.items, isEmpty);
      expect(receiver.pendingCount, 0);
    });
  });

  test('保存の直後に見えなくても、読み直しで見つかれば出す(結果整合)', () {
    fakeAsync((async) {
      final row = mediaEvent('2026-10-13T00:00:01.000Z');
      receiver.receive(messageFor(row), fromParticipant: false);
      async.flushMicrotasks();
      expect(feed.items, isEmpty);
      timeline.rows = [row];
      async.elapse(const Duration(seconds: 1));
      expect(feed.items, hasLength(1));
      async.elapse(const Duration(seconds: 10));
      expect(timeline.calls, 2);
    });
  });

  test('履歴を読めなければ、読み直す', () {
    fakeAsync((async) {
      final row = mediaEvent('2026-10-13T00:00:01.000Z');
      timeline
        ..rows = [row]
        ..error = Exception('503');
      receiver.receive(messageFor(row), fromParticipant: false);
      async.flushMicrotasks();
      expect(feed.items, isEmpty);
      timeline.error = null;
      async.elapse(const Duration(seconds: 1));
      expect(feed.items, hasLength(1));
    });
  });

  test('同じ event_id は重ねない(表示済み、確かめ中、complete のやり直し)', () {
    fakeAsync((async) {
      final mine = mediaEvent('2026-10-13T00:00:01.000Z', sourceId: 'mine');
      final other = mediaEvent('2026-10-13T00:00:02.000Z', sourceId: 'other');
      timeline.rows = [other, mine];
      // 自分の送信は complete の応答で出してある
      feed.add(mine);
      expect(
        receiver.receive(messageFor(mine), fromParticipant: false),
        MediaReceiveResult.duplicate,
      );
      timeline.gate = Completer();
      expect(
        receiver.receive(messageFor(other), fromParticipant: false),
        MediaReceiveResult.checking,
      );
      expect(
        receiver.receive(messageFor(other), fromParticipant: false),
        MediaReceiveResult.duplicate,
      );
      timeline.gate!.complete();
      async.flushMicrotasks();
      expect(
        receiver.receive(messageFor(other), fromParticipant: false),
        MediaReceiveResult.duplicate,
      );
      expect(timeline.calls, 1);
      expect(feed.items, hasLength(2));
    });
  });

  test('読んでいる間に届いたものは、読み終えてから1回でまとめて確かめる', () {
    fakeAsync((async) {
      final rows = [
        for (var i = 0; i < 5; i++)
          mediaEvent('2026-10-13T00:00:0$i.000Z', sourceId: 'm$i'),
      ];
      timeline
        ..rows = rows
        ..gate = Completer();
      for (final r in rows) {
        receiver.receive(messageFor(r), fromParticipant: false);
      }
      expect(timeline.calls, 1);
      timeline.gate!.complete();
      timeline.gate = null;
      async.flushMicrotasks();
      expect(timeline.calls, 2);
      expect(feed.items, hasLength(5));
    });
  });

  test('読めないもの、event_id の空のものは捨てる', () {
    expect(
      receiver.receive([0xff, 0xff, 0xff], fromParticipant: false),
      MediaReceiveResult.invalid,
    );
    expect(
      receiver.receive(MediaMessage().writeToBuffer(), fromParticipant: false),
      MediaReceiveResult.invalid,
    );
  });

  test('確かめ待ちが上限を超えたら捨てる', () {
    fakeAsync((async) {
      receiver = MediaReceiver(
        fetchRecent: timeline.fetch,
        onConfirmed: feed.addAll,
        isKnown: feed.contains,
        maxPending: 2,
      );
      timeline.gate = Completer();
      final results = [
        for (var i = 0; i < 3; i++)
          receiver.receive(
            messageFor(
              mediaEvent('2026-10-13T00:00:0$i.000Z', sourceId: 'm$i'),
            ),
            fromParticipant: false,
          ),
      ];
      expect(results.last, MediaReceiveResult.overflow);
      receiver.dispose();
      timeline.gate!.complete();
      async.flushMicrotasks();
      expect(feed.items, isEmpty);
    });
  });

  test('dispose の後は読み直さない', () {
    fakeAsync((async) {
      receiver.receive(
        messageFor(mediaEvent('2026-10-13T00:00:01.000Z')),
        fromParticipant: false,
      );
      async.flushMicrotasks();
      receiver.dispose();
      async.elapse(const Duration(seconds: 10));
      expect(timeline.calls, 1);
    });
  });
}
