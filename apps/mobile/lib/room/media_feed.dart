import 'package:voice_intercom_api_client/api.dart';

import 'caption_board.dart';

/// ルームの画面に出す画像・動画。履歴の行(kind が media の TimelineEvent)の形で持ち、
/// event_id で重ねない。
///
/// 入れ口は3つ(設計メモの「アプリの表示と再生」):
/// - 自分の送信: complete の応答(履歴の行)
/// - 抜けを埋める: 入室とつなぎ直しのときに読む `GET /rooms/{room_id}/timeline`
/// - ルームへの配信: データチャネル(topic `media`)の `MediaMessage`。まだ受けていない。
///   受けるときは、送信元の参加者があるものを捨て、`MediaMessage` を同じ形の
///   [TimelineEvent] にして [add] に渡す(README の「画像・動画」)。
class MediaFeed {
  MediaFeed({this.maxItems = 200});

  /// 持っておく件数の上限。古いものから捨てる(過去のものは履歴の画面で見る)
  final int maxItems;
  final Map<String, TimelineEvent> _items = {};

  /// occurred_at の古い順
  List<TimelineEvent> get items {
    final list = _items.values.toList();
    list.sort((a, b) => a.eventId.compareTo(b.eventId));
    return list;
  }

  bool contains(String eventId) => _items.containsKey(eventId);

  /// 足す。画像・動画でないものと、もうあるもの(同じ event_id)は捨てる。足したら true
  bool add(TimelineEvent event) {
    if (event.kind != TimelineEventKindEnum.media || event.media == null) {
      return false;
    }
    if (_items.containsKey(event.eventId)) {
      return false;
    }
    _items[event.eventId] = event;
    if (_items.length > maxItems) {
      // event_id は `<occurred_at>#<source_id>` で、文字列の順が時刻の順になる
      final oldest = _items.keys.reduce((a, b) => a.compareTo(b) <= 0 ? a : b);
      _items.remove(oldest);
    }
    return true;
  }

  /// まとめて足す。1件でも足したら true
  bool addAll(Iterable<TimelineEvent> events) {
    var added = false;
    for (final e in events) {
      added = add(e) || added;
    }
    return added;
  }
}

/// ルームの画面の時間の流れの1件。字幕か画像・動画。
sealed class RoomFeedEntry {
  DateTime get at;
}

class CaptionEntry extends RoomFeedEntry {
  CaptionEntry(this.segment);

  final CaptionSegment segment;

  @override
  DateTime get at => segment.receivedAt;
}

class MediaEntry extends RoomFeedEntry {
  MediaEntry(this.event)
    : at =
          DateTime.tryParse(event.occurredAt) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);

  final TimelineEvent event;

  @override
  final DateTime at;
}

/// 字幕と画像・動画を時刻の順(古い順)に並べる。字幕は届いた時刻、画像・動画は
/// occurred_at(サーバーの時刻)なので、端末の時計がずれていれば前後しうる。
List<RoomFeedEntry> mergeRoomFeed(
  List<CaptionSegment> segments,
  List<TimelineEvent> media,
) {
  final entries = <RoomFeedEntry>[
    for (final s in segments) CaptionEntry(s),
    for (final m in media) MediaEntry(m),
  ];
  // 同じ時刻なら、元の並び(字幕は届いた順、画像・動画は event_id の順)を保つ
  final indexed = entries.indexed.toList();
  indexed.sort((a, b) {
    final c = a.$2.at.compareTo(b.$2.at);
    return c != 0 ? c : a.$1.compareTo(b.$1);
  });
  return [for (final (_, e) in indexed) e];
}
