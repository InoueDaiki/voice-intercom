import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/room/caption_board.dart';
import 'package:voice_intercom/room/media_feed.dart';

import 'support/media_fixtures.dart';

CaptionSegment segment(String id, DateTime at) => CaptionSegment(
  segmentId: id,
  speakerIdentity: 'bob',
  utteranceId: '',
  segmentIndex: 0,
  messageId: '',
  receivedAt: at,
);

void main() {
  test('event_id で重ねず、古い順に並べる', () {
    final feed = MediaFeed();
    expect(
      feed.add(mediaEvent('2026-10-13T00:00:02.000Z', sourceId: 'b')),
      isTrue,
    );
    expect(
      feed.add(mediaEvent('2026-10-13T00:00:01.000Z', sourceId: 'a')),
      isTrue,
    );
    // complete の応答と、後から読む履歴(や MediaMessage)が同じ行を持ってくる
    expect(
      feed.add(mediaEvent('2026-10-13T00:00:02.000Z', sourceId: 'b')),
      isFalse,
    );
    expect(feed.items.map((e) => e.media!.mediaId), ['a', 'b']);
  });

  test('画像・動画でない履歴の行は捨てる', () {
    final feed = MediaFeed();
    final added = feed.addAll([
      textEvent('2026-10-13T00:00:01.000Z'),
      mediaEvent('2026-10-13T00:00:02.000Z'),
    ]);
    expect(added, isTrue);
    expect(feed.items, hasLength(1));
    expect(feed.addAll([textEvent('2026-10-13T00:00:03.000Z')]), isFalse);
  });

  test('上限を超えたら古いものから捨てる', () {
    final feed = MediaFeed(maxItems: 2);
    feed.addAll([
      mediaEvent('2026-10-13T00:00:03.000Z', sourceId: 'c'),
      mediaEvent('2026-10-13T00:00:01.000Z', sourceId: 'a'),
      mediaEvent('2026-10-13T00:00:02.000Z', sourceId: 'b'),
    ]);
    expect(feed.items.map((e) => e.media!.mediaId), ['b', 'c']);
    expect(feed.contains('2026-10-13T00:00:01.000Z#a'), isFalse);
  });

  test('字幕と画像・動画を時刻の順に並べる', () {
    final entries = mergeRoomFeed(
      [
        segment('s1', DateTime.utc(2026, 10, 13, 0, 0, 1)),
        segment('s2', DateTime.utc(2026, 10, 13, 0, 0, 3)),
      ],
      [
        mediaEvent('2026-10-13T00:00:02.000Z', sourceId: 'm'),
        // 入室より前の履歴
        mediaEvent('2026-10-12T23:00:00.000Z', sourceId: 'old'),
      ],
    );
    expect(
      entries.map(
        (e) => switch (e) {
          CaptionEntry(:final segment) => segment.segmentId,
          MediaEntry(:final event) => event.media!.mediaId,
        },
      ),
      ['old', 's1', 'm', 's2'],
    );
  });
}
