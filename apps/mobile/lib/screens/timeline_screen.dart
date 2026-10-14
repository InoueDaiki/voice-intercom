import 'package:flutter/material.dart';
import 'package:voice_intercom_api_client/api.dart';

import '../app_state.dart';
import 'deletion_widgets.dart';
import 'media_widgets.dart';

/// ルームの履歴(GET /rooms/{room_id}/timeline)。新しい順に出し、「もっと見る」で古いものを読む。
/// 消した行は「削除された…」と出す。自分の送ったテキストと画像・動画は、長押しで消せる。
class TimelineScreen extends StatefulWidget {
  const TimelineScreen({
    super.key,
    required this.state,
    required this.room,
    required this.myLanguage,
  });

  final AppState state;
  final Room room;
  final String myLanguage;

  @override
  State<TimelineScreen> createState() => _TimelineScreenState();
}

class _TimelineScreenState extends State<TimelineScreen> {
  static const _pageSize = 50;

  final List<TimelineEvent> _items = [];
  String? _nextBefore;
  bool _loading = false;
  bool _done = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading || _done) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.state.api.listTimeline(
        widget.room.roomId,
        limit: _pageSize,
        before: _nextBefore,
      );
      _items.addAll(page.items);
      _nextBefore = page.nextBefore;
      _done = page.nextBefore == null;
    } catch (e) {
      _error = '読めなかった: $e';
    }
    if (mounted) {
      setState(() => _loading = false);
    }
  }

  /// 自分の送ったテキストか画像・動画を消し、行を墓石に置き換える
  Future<void> _delete(int index) async {
    final event = _items[index];
    if (!await confirmDeletion(context, deletionWhat(event))) {
      return;
    }
    try {
      final tombstone = await widget.state.api.deleteTimelineEvent(
        widget.room.roomId,
        event.eventId,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        final i = _items.indexWhere((e) => e.eventId == tombstone.eventId);
        if (i >= 0) {
          _items[i] = tombstone;
        }
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('消せなかった: $e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final myId = widget.state.profile?.userId;
    return Scaffold(
      appBar: AppBar(title: Text('${widget.room.name} の履歴')),
      body: ListView.builder(
        itemCount: _items.length + 1,
        itemBuilder: (context, i) {
          if (i == _items.length) {
            if (_error != null) {
              return ListTile(
                title: Text(_error!),
                trailing: TextButton(
                  onPressed: _load,
                  child: const Text('やり直す'),
                ),
              );
            }
            if (_loading) {
              return const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              );
            }
            if (_done) {
              return ListTile(title: Text(_items.isEmpty ? '履歴はない' : 'ここまで'));
            }
            return TextButton(onPressed: _load, child: const Text('もっと見る'));
          }
          final e = _items[i];
          final translation = e.translations[widget.myLanguage];
          final kind = switch (e.kind) {
            TimelineEventKindEnum.utterance => '音声',
            TimelineEventKindEnum.text => 'テキスト',
            TimelineEventKindEnum.media => '画像・動画',
          };
          final media = e.media;
          final who = e.senderId == myId ? '自分' : e.senderId;
          if (e.deleted != null) {
            return ListTile(
              key: Key('event-${e.eventId}'),
              title: DeletedText(deletedLabel(e)),
              subtitle: Text('$who ・ $kind ・ ${formatTime(e.occurredAt)}'),
            );
          }
          final deletable =
              e.senderId == myId && e.kind != TimelineEventKindEnum.utterance;
          final onLongPress = deletable ? () => _delete(i) : null;
          if (e.kind == TimelineEventKindEnum.media && media != null) {
            return ListTile(
              leading: MediaThumbnail(event: e, width: 56, height: 56),
              title: Text(
                e.text.isEmpty ? (isVideoMedia(media) ? '動画' : '画像') : e.text,
              ),
              subtitle: Text(
                '${e.senderId == myId ? '自分' : e.senderId} ・ $kind ・ ${formatTime(e.occurredAt)}',
              ),
              onTap: () => openMediaViewer(context, e),
              onLongPress: onLongPress,
            );
          }
          return ListTile(
            key: Key('event-${e.eventId}'),
            onLongPress: onLongPress,
            title: Text(e.text.isEmpty ? '(本文なし)' : e.text),
            subtitle: Text(
              [
                if (translation != null && translation.isNotEmpty)
                  '[${widget.myLanguage}] $translation',
                '${e.senderId == myId ? '自分' : e.senderId} ・ $kind ・ ${formatTime(e.occurredAt)}',
              ].join('\n'),
            ),
          );
        },
      ),
    );
  }
}
