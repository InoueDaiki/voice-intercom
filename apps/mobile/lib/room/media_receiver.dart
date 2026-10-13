import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:voice_intercom_api_client/api.dart' show TimelineEvent;
import 'package:voice_intercom_schema/gen/voiceintercom/v1/media.pb.dart';

/// 受け取った `MediaMessage` をどうしたか(テストとログのため)
enum MediaReceiveResult {
  /// 履歴で確かめる(確かめたら [MediaReceiver.onConfirmed] に渡す)
  checking,

  /// 送信元の参加者があった(参加者が送ったもの。topic を偽れるので捨てる)
  fromParticipant,

  /// `MediaMessage` として読めない、または event_id が空
  invalid,

  /// もう表示している、または確かめている途中(complete のやり直し、自分の送信)
  duplicate,

  /// 確かめ待ちが多すぎる
  overflow,
}

/// データチャネル(topic `media`)の `MediaMessage` を、履歴で確かめてからルームの表示に渡す。
///
/// 送信元の参加者が null というだけでは、API(Server API)から来たとは言えない。受け手が
/// 新しい参加者を知るまでの約3秒は、参加者が送ったデータも null で届く(設計メモの
/// 「サーバー側の確認」)。そこで `MediaMessage` は「履歴に新しい行がある」という知らせとして
/// 扱い、`GET /rooms/{room_id}/timeline` の先頭のページで event_id の行を確かめ、表示には
/// 履歴の行を使う(無ければ捨てる)。理由は README の「画像・動画」の「受ける」。
///
/// - 履歴を読むのは同時に1回だけ。読んでいる間に届いたものは、読み終えてからまとめて確かめる
///   (たくさん届いても、履歴を読む回数は増えすぎない)。
/// - 履歴の読み込みは DynamoDB の結果整合の読み取りなので、保存の直後は行がまだ見えないことがある。
///   見つからなければ [retryDelays] の間隔で読み直し、それでも無ければ捨てる。
class MediaReceiver {
  MediaReceiver({
    required this.fetchRecent,
    required this.onConfirmed,
    required this.isKnown,
    this.retryDelays = const [Duration(seconds: 1), Duration(seconds: 3)],
    this.maxPending = 50,
  });

  /// 履歴の先頭のページ(新しい順)を読む
  final Future<List<TimelineEvent>> Function() fetchRecent;

  /// 確かめた履歴の行を渡す(ルームの表示に足す)
  final void Function(List<TimelineEvent> events) onConfirmed;

  /// もう表示している event_id か
  final bool Function(String eventId) isKnown;

  /// 見つからなかったときに読み直すまでの間隔。長さが読み直しの回数
  final List<Duration> retryDelays;

  /// 確かめ待ちの上限。超えたものは捨てる(履歴を開けば見られる)
  final int maxPending;

  // 確かめ待ちの event_id と、見つからなかった回数
  final Map<String, int> _pending = {};

  // 次の読み込みで確かめるもの(届いたばかりか、読み直しの時刻が来たもの)
  final Set<String> _due = {};
  final Set<Timer> _timers = {};
  bool _fetching = false;
  bool _again = false;
  bool _disposed = false;

  /// 確かめ待ちの件数(テスト用)
  @visibleForTesting
  int get pendingCount => _pending.length;

  /// データチャネルで受け取った。[fromParticipant] は送信元の参加者があるか
  /// (`DataReceivedEvent.participant != null`)
  MediaReceiveResult receive(List<int> data, {required bool fromParticipant}) {
    if (_disposed) {
      return MediaReceiveResult.invalid;
    }
    if (fromParticipant) {
      return MediaReceiveResult.fromParticipant;
    }
    final MediaMessage message;
    try {
      message = MediaMessage.fromBuffer(data);
    } on Exception {
      return MediaReceiveResult.invalid;
    }
    final eventId = message.eventId;
    if (eventId.isEmpty) {
      return MediaReceiveResult.invalid;
    }
    if (isKnown(eventId) || _pending.containsKey(eventId)) {
      return MediaReceiveResult.duplicate;
    }
    if (_pending.length >= maxPending) {
      return MediaReceiveResult.overflow;
    }
    _pending[eventId] = 0;
    _due.add(eventId);
    _fetch();
    return MediaReceiveResult.checking;
  }

  void _fetch() {
    if (_fetching) {
      _again = true;
      return;
    }
    _fetching = true;
    unawaited(_run());
  }

  Future<void> _run() async {
    try {
      do {
        _again = false;
        // 読み始めた時点で待っているものだけを、この読み込みで確かめる。
        // 読んでいる間に届いたものは、行がまだ無いかもしれないので次の読み込みで確かめる
        final checking = _due.toList();
        _due.clear();
        List<TimelineEvent>? rows;
        try {
          rows = await fetchRecent();
        } catch (e) {
          debugPrint('履歴を読めなかった(画像・動画の確かめ): $e');
        }
        if (_disposed) {
          return;
        }
        final byId = {for (final r in rows ?? <TimelineEvent>[]) r.eventId: r};
        final confirmed = <TimelineEvent>[];
        // 読み直しを待っているものも、行があれば確かめられたことにする
        for (final id in _pending.keys.toList()) {
          final row = byId[id];
          if (row != null && row.media != null) {
            _pending.remove(id);
            _due.remove(id);
            confirmed.add(row);
          } else if (checking.contains(id)) {
            _missed(id);
          }
        }
        if (confirmed.isNotEmpty) {
          onConfirmed(confirmed);
        }
      } while (_again && !_disposed);
    } finally {
      _fetching = false;
    }
  }

  // 見つからなかった(または読めなかった)。間を置いて読み直すか、捨てる
  void _missed(String eventId) {
    final misses = (_pending[eventId] ?? 0) + 1;
    if (misses > retryDelays.length) {
      _pending.remove(eventId);
      debugPrint('履歴に無い画像・動画の知らせを捨てた: $eventId');
      return;
    }
    _pending[eventId] = misses;
    late final Timer timer;
    timer = Timer(retryDelays[misses - 1], () {
      _timers.remove(timer);
      if (!_disposed && _pending.containsKey(eventId)) {
        _due.add(eventId);
        _fetch();
      }
    });
    _timers.add(timer);
  }

  void dispose() {
    _disposed = true;
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
    _pending.clear();
    _due.clear();
  }
}
