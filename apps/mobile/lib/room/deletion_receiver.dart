import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:voice_intercom_api_client/api.dart' show TimelineEvent;
import 'package:voice_intercom_schema/gen/voiceintercom/v1/deletion.pb.dart';

/// 受け取った `DeletionMessage` をどうしたか(テストとログのため)
enum DeletionReceiveResult {
  /// 履歴で確かめる(確かめたら [DeletionReceiver.onConfirmed] に渡す)
  checking,

  /// 送信元の参加者があった(参加者が送ったもの。topic を偽れるので捨てる)
  fromParticipant,

  /// `DeletionMessage` として読めない、または event_id が空
  invalid,

  /// もう反映している、または確かめている途中(DELETE のやり直し、自分の削除)
  duplicate,

  /// 確かめ待ちが多すぎる
  overflow,
}

/// データチャネル(topic `deletion`)の `DeletionMessage` を、履歴で確かめてから表示に渡す。
///
/// 画像・動画の配信(`MediaReceiver`)と同じく、送信元の参加者が null というだけでは API から来たと
/// 言えない(入った直後の参加者が送ったものも null で届く)。そこで `DeletionMessage` は
/// 「行が消された」という知らせとして扱い、`GET /rooms/{room_id}/timeline/event` で event_id の行を
/// 読み、消されている(`deleted` がある)ときだけ、その行(墓石)を渡す。表示を変えるのに使う送信者と
/// message_id も行のものなので、偽の知らせで他人のものを消したように見せることはできない
/// (行を消せるのは送った本人だけ)。
///
/// 1件の取得は強い整合の読み取りなので、行が消されていなければ偽の知らせとみなして捨てる。
/// 読めなかった(通信の失敗など)ときだけ [retryDelays] の間隔で読み直す。
class DeletionReceiver {
  DeletionReceiver({
    required this.fetchEvent,
    required this.onConfirmed,
    required this.isApplied,
    this.retryDelays = const [Duration(seconds: 1), Duration(seconds: 3)],
    this.maxPending = 50,
  });

  /// 履歴の1件を読む。無ければ null
  final Future<TimelineEvent?> Function(String eventId) fetchEvent;

  /// 確かめた墓石を渡す(表示を「削除された…」に変える)
  final void Function(TimelineEvent tombstone) onConfirmed;

  /// もう墓石を反映している event_id か
  final bool Function(String eventId) isApplied;

  /// 読めなかったときに読み直すまでの間隔。長さが読み直しの回数
  final List<Duration> retryDelays;

  /// 確かめ待ちの上限。超えたものは捨てる(入り直すか履歴を開けば反映される)
  final int maxPending;

  final Set<String> _pending = {};
  final Set<Timer> _timers = {};
  bool _disposed = false;

  /// 確かめ待ちの件数(テスト用)
  @visibleForTesting
  int get pendingCount => _pending.length;

  /// データチャネルで受け取った。[fromParticipant] は送信元の参加者があるか
  DeletionReceiveResult receive(
    List<int> data, {
    required bool fromParticipant,
  }) {
    if (_disposed) {
      return DeletionReceiveResult.invalid;
    }
    if (fromParticipant) {
      return DeletionReceiveResult.fromParticipant;
    }
    final DeletionMessage message;
    try {
      message = DeletionMessage.fromBuffer(data);
    } on Exception {
      return DeletionReceiveResult.invalid;
    }
    final eventId = message.eventId;
    if (eventId.isEmpty) {
      return DeletionReceiveResult.invalid;
    }
    if (isApplied(eventId) || _pending.contains(eventId)) {
      return DeletionReceiveResult.duplicate;
    }
    if (_pending.length >= maxPending) {
      return DeletionReceiveResult.overflow;
    }
    _pending.add(eventId);
    unawaited(_check(eventId, 0));
    return DeletionReceiveResult.checking;
  }

  Future<void> _check(String eventId, int attempt) async {
    TimelineEvent? row;
    try {
      row = await fetchEvent(eventId);
    } catch (e) {
      if (_disposed) {
        return;
      }
      if (attempt >= retryDelays.length) {
        _pending.remove(eventId);
        debugPrint('消した知らせを確かめられなかった: $eventId $e');
        return;
      }
      late final Timer timer;
      timer = Timer(retryDelays[attempt], () {
        _timers.remove(timer);
        if (!_disposed) {
          unawaited(_check(eventId, attempt + 1));
        }
      });
      _timers.add(timer);
      return;
    }
    if (_disposed) {
      return;
    }
    _pending.remove(eventId);
    if (row == null || row.deleted == null || row.eventId != eventId) {
      debugPrint('履歴で消されていない行の知らせを捨てた: $eventId');
      return;
    }
    onConfirmed(row);
  }

  void dispose() {
    _disposed = true;
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
    _pending.clear();
  }
}
