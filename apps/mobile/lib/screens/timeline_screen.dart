import 'package:flutter/material.dart';
import 'package:voice_intercom_api_client/api.dart';

import '../app_state.dart';

/// ルームの履歴(GET /rooms/{room_id}/timeline)。新しい順に出し、「もっと見る」で古いものを読む。
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
          return ListTile(
            title: Text(e.text.isEmpty ? '(本文なし)' : e.text),
            subtitle: Text(
              [
                if (translation != null && translation.isNotEmpty)
                  '[${widget.myLanguage}] $translation',
                '${e.senderId == myId ? '自分' : e.senderId} ・ $kind ・ ${_time(e.occurredAt)}',
              ].join('\n'),
            ),
          );
        },
      ),
    );
  }

  String _time(String iso) {
    final t = DateTime.tryParse(iso)?.toLocal();
    if (t == null) {
      return iso;
    }
    String two(int v) => v.toString().padLeft(2, '0');
    return '${t.month}/${t.day} ${two(t.hour)}:${two(t.minute)}';
  }
}
