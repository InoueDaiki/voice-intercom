import 'package:flutter/material.dart';
import 'package:voice_intercom_api_client/api.dart';

import '../app_state.dart';
import '../languages.dart';
import '../room/caption_board.dart';
import '../room/room_session.dart';
import '../room/text_sender.dart';
import 'timeline_screen.dart';

/// ルームの画面。入室、PTT、字幕、テキスト入力。
class RoomScreen extends StatefulWidget {
  const RoomScreen({super.key, required this.state, required this.room});

  final AppState state;
  final Room room;

  @override
  State<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends State<RoomScreen> {
  late final RoomSession _session;
  final _text = TextEditingController();

  @override
  void initState() {
    super.initState();
    final profile = widget.state.profile!;
    _session = RoomSession(
      myIdentity: profile.userId,
      myLanguage: profile.language.toJson(),
    );
    _join();
  }

  Future<void> _join() async {
    final LiveKitTokenResponse token;
    try {
      token = await widget.state.api.createLiveKitToken(widget.room.roomId);
    } on ApiException catch (e) {
      if (e.code == 409) {
        // プロフィールが未登録。登録の画面に戻す
        if (mounted) {
          Navigator.of(context).pop();
        }
        widget.state.profileMissing();
        return;
      }
      _session.error = 'トークンを取れなかった: ${e.code} ${e.message}';
      setState(() {});
      return;
    }
    try {
      await _session.connect(token.serverUrl, token.participantToken);
    } catch (_) {
      // エラーは画面に出す(_session.error)
    }
  }

  @override
  void dispose() {
    _session.dispose();
    _text.dispose();
    super.dispose();
  }

  void _send() {
    if (_session.textSender.submit(_text.text) != null) {
      _text.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.room.name),
        actions: [
          IconButton(
            tooltip: '履歴',
            icon: const Icon(Icons.history),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => TimelineScreen(
                  state: widget.state,
                  room: widget.room,
                  myLanguage: _session.myLanguage,
                ),
              ),
            ),
          ),
        ],
      ),
      body: ListenableBuilder(
        listenable: _session,
        builder: (context, _) => SafeArea(
          child: Column(
            children: [
              _StatusBar(session: _session),
              Expanded(child: _Captions(session: _session)),
              _PendingTexts(session: _session),
              _TextInput(
                controller: _text,
                enabled: _session.connected,
                onSend: _send,
              ),
              _PttButton(session: _session),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  const _StatusBar({required this.session});

  final RoomSession session;

  @override
  Widget build(BuildContext context) {
    final error = session.error;
    final String status;
    if (!session.connected) {
      status = error ?? '接続中…';
    } else {
      status =
          '${session.warning == null ? '' : '${session.warning}\n'}'
          '${session.participantCount}人 ・ 翻訳 ${session.agentPresent ? 'あり' : 'なし(Agent がいない)'} ・ '
          '${languageName(session.myLanguage)}で聞く';
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: error != null
          ? Theme.of(context).colorScheme.errorContainer
          : Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Text(status, key: const Key('status')),
    );
  }
}

/// 字幕。区切りごとに、原文と自分の言語の訳を並べる。新しいものが下。
class _Captions extends StatelessWidget {
  const _Captions({required this.session});

  final RoomSession session;

  @override
  Widget build(BuildContext context) {
    final segments = session.captions.segments.reversed.toList();
    if (segments.isEmpty) {
      return const Center(child: Text('字幕はまだない'));
    }
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.all(8),
      itemCount: segments.length,
      itemBuilder: (context, i) => _CaptionTile(
        segment: segments[i],
        speaker: session.displayName(segments[i].speakerIdentity),
        myLanguage: session.myLanguage,
      ),
    );
  }
}

class _CaptionTile extends StatelessWidget {
  const _CaptionTile({
    required this.segment,
    required this.speaker,
    required this.myLanguage,
  });

  final CaptionSegment segment;
  final String speaker;
  final String myLanguage;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final original = segment.original;
    // 話者と同じ言語なら訳は無い(Agent が作らない)
    final translation = segment.originalLanguage == myLanguage
        ? null
        : segment.translations[myLanguage];
    TextStyle? style(CaptionText t) =>
        t.isFinal ? null : TextStyle(color: theme.colorScheme.onSurfaceVariant);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$speaker${segment.isText ? '(テキスト)' : ''}',
              style: theme.textTheme.labelMedium,
            ),
            if (original != null && original.text.isNotEmpty)
              Text(
                '[${segment.originalLanguage.isEmpty ? '?' : segment.originalLanguage}] ${original.text}${original.isFinal ? '' : '…'}',
                style: style(original),
              ),
            if (translation != null && translation.text.isNotEmpty)
              Text(
                '[$myLanguage] ${translation.text}${translation.isFinal ? '' : '…'}',
                style: (style(translation) ?? const TextStyle()).copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// 送ったテキストのうち、まだ字幕が返ってこないもの
class _PendingTexts extends StatelessWidget {
  const _PendingTexts({required this.session});

  final RoomSession session;

  @override
  Widget build(BuildContext context) {
    final pending = session.textSender.items
        .where((t) => t.state != OutgoingTextState.delivered)
        .toList();
    if (pending.isEmpty) {
      return const SizedBox.shrink();
    }
    return Column(
      children: [
        for (final t in pending)
          ListTile(
            dense: true,
            title: Text(t.text),
            trailing: Text(
              t.state == OutgoingTextState.failed
                  ? '届かなかった'
                  : '送信中(${t.attempts}回目)',
            ),
          ),
      ],
    );
  }
}

class _TextInput extends StatelessWidget {
  const _TextInput({
    required this.controller,
    required this.enabled,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              key: const Key('textInput'),
              controller: controller,
              enabled: enabled,
              decoration: const InputDecoration(hintText: 'テキストを送る'),
              onSubmitted: (_) => onSend(),
            ),
          ),
          IconButton(
            key: const Key('sendText'),
            icon: const Icon(Icons.send),
            onPressed: enabled ? onSend : null,
          ),
        ],
      ),
    );
  }
}

/// 押している間だけマイクのミュートを外す
class _PttButton extends StatelessWidget {
  const _PttButton({required this.session});

  final RoomSession session;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final enabled = session.connected;
    final label = !enabled
        ? '入室待ち'
        : session.talking
        ? '話しています'
        : session.pressing
        ? 'マイクを開いています…'
        : '押して話す';
    // タップの判定を待たずに、指が触れた・離れた時点で切り替える
    return Listener(
      onPointerDown: enabled ? (_) => session.setPressing(true) : null,
      onPointerUp: enabled ? (_) => session.setPressing(false) : null,
      onPointerCancel: enabled ? (_) => session.setPressing(false) : null,
      child: Container(
        key: const Key('ptt'),
        margin: const EdgeInsets.all(16),
        height: 96,
        width: double.infinity,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: !enabled
              ? scheme.surfaceContainerHighest
              : session.talking
              ? scheme.error
              : scheme.primary,
          borderRadius: BorderRadius.circular(48),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: enabled ? scheme.onPrimary : scheme.onSurfaceVariant,
            fontSize: 20,
          ),
        ),
      ),
    );
  }
}
