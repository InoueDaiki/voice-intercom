import 'package:flutter/material.dart';
import 'package:voice_intercom_api_client/api.dart';

import '../app_state.dart';
import '../languages.dart';
import '../media/api_media_backend.dart';
import '../media/media_picker.dart';
import '../media/media_uploader.dart';
import '../room/caption_board.dart';
import '../room/media_feed.dart';
import '../room/room_session.dart';
import '../room/text_sender.dart';
import 'deletion_widgets.dart';
import 'media_widgets.dart';
import 'timeline_screen.dart';

/// ルームの画面。入室、PTT、字幕、テキスト入力、画像・動画の送信と表示。
class RoomScreen extends StatefulWidget {
  const RoomScreen({super.key, required this.state, required this.room});

  final AppState state;
  final Room room;

  @override
  State<RoomScreen> createState() => RoomScreenState();
}

class RoomScreenState extends State<RoomScreen> {
  late final RoomSession _session;

  /// 統合テストで、画面を描かずに(バックグラウンドで)接続の状態を見る
  @visibleForTesting
  RoomSession get session => _session;
  final _text = TextEditingController();
  late final ApiMediaBackend _mediaBackend;
  late final MediaUploader _uploader;

  /// 統合テストで、image_picker を通さずにファイルを送る
  @visibleForTesting
  MediaUploader get uploader => _uploader;

  @override
  void initState() {
    super.initState();
    final profile = widget.state.profile!;
    _session = RoomSession(
      myIdentity: profile.userId,
      myLanguage: profile.language.toJson(),
      roomName: widget.room.name,
      // topic `media` の知らせを、履歴の先頭のページで確かめる
      fetchRecentTimeline: () async =>
          (await widget.state.api.listTimeline(widget.room.roomId)).items,
      // topic `deletion` の知らせを、1件の取得で確かめる
      fetchTimelineEvent: (eventId) =>
          widget.state.api.getTimelineEvent(widget.room.roomId, eventId),
      deleteTimelineEvent: (eventId) =>
          widget.state.api.deleteTimelineEvent(widget.room.roomId, eventId),
    )..onReconnected = _loadRecentMedia;
    _mediaBackend = ApiMediaBackend(widget.state.api);
    _uploader = MediaUploader(
      roomId: widget.room.roomId,
      backend: _mediaBackend,
      onChanged: () {
        if (mounted) {
          setState(() {});
        }
      },
      // complete の応答(履歴の行)ですぐ出す
      onCompleted: (event) => _session.addMedia([event]),
    );
    _join();
  }

  /// 履歴の新しい分から画像・動画を読み、ルームの表示に足す(入室とつなぎ直しのとき)。
  /// データチャネルはつながっている間しか届かないので、その抜けを埋める。
  /// 消された行(墓石)も反映する(切れていた間に消されたテキスト・画像・動画)。
  Future<void> _loadRecentMedia() async {
    try {
      final page = await widget.state.api.listTimeline(widget.room.roomId);
      if (mounted) {
        _session.applyTimeline(page.items);
      }
    } catch (e) {
      // 出せなくても入室は続ける。履歴の画面で見られる
      debugPrint('履歴の画像・動画を読めなかった: $e');
    }
  }

  Future<void> _pickMedia() async {
    final source = await showModalBottomSheet<MediaPickSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('写真・動画を選ぶ'),
              onTap: () => Navigator.of(context).pop(MediaPickSource.library),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('写真を撮る'),
              onTap: () => Navigator.of(context).pop(MediaPickSource.photo),
            ),
            ListTile(
              leading: const Icon(Icons.videocam_outlined),
              title: const Text('動画を撮る'),
              onTap: () => Navigator.of(context).pop(MediaPickSource.video),
            ),
          ],
        ),
      ),
    );
    if (source == null) {
      return;
    }
    final String? path;
    try {
      path = await pickMediaFile(source);
    } catch (e) {
      // 権限を断られた、カメラが無いなど
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('選べなかった: $e')));
      }
      return;
    }
    if (path != null && mounted) {
      _uploader.submit(path);
    }
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
      return;
    }
    await _loadRecentMedia();
  }

  @override
  void dispose() {
    _uploader.dispose();
    _mediaBackend.close();
    _session.dispose();
    _text.dispose();
    super.dispose();
  }

  void _showError(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    }
  }

  /// 自分の送ったテキストを消す(長押しのメニューと確認の後)
  Future<void> _deleteCaption(CaptionSegment segment) async {
    if (!await confirmDeletion(context, 'テキスト')) {
      return;
    }
    try {
      await _session.deleteOwnText(segment);
    } on NotSavedYetException {
      _showError('まだ履歴に保存されていないので消せなかった。少し待ってからやり直す');
    } catch (e) {
      _showError('消せなかった: $e');
    }
  }

  /// 自分の送った画像・動画を消す
  Future<void> _deleteMedia(TimelineEvent event) async {
    if (!await confirmDeletion(context, deletionWhat(event))) {
      return;
    }
    try {
      await _session.deleteOwnMedia(event);
    } catch (e) {
      _showError('消せなかった: $e');
    }
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
              Expanded(
                child: _Feed(
                  session: _session,
                  onDeleteCaption: _deleteCaption,
                  onDeleteMedia: _deleteMedia,
                ),
              ),
              _PendingTexts(session: _session),
              OutgoingMediaList(
                items: _uploader.items,
                onRetry: _uploader.retry,
                onDismiss: _uploader.dismiss,
              ),
              _TextInput(
                controller: _text,
                enabled: _session.connected,
                onSend: _send,
                onAttach: _pickMedia,
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

/// 字幕と画像・動画を、時刻の順に並べる。新しいものが下。
/// 字幕は区切りごとに、原文と自分の言語の訳を並べる。
class _Feed extends StatelessWidget {
  const _Feed({
    required this.session,
    required this.onDeleteCaption,
    required this.onDeleteMedia,
  });

  final RoomSession session;
  final void Function(CaptionSegment segment) onDeleteCaption;
  final void Function(TimelineEvent event) onDeleteMedia;

  @override
  Widget build(BuildContext context) {
    final entries = mergeRoomFeed(
      session.captions.segments,
      session.media.items,
    ).reversed.toList();
    if (entries.isEmpty) {
      return const Center(child: Text('字幕はまだない'));
    }
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.all(8),
      itemCount: entries.length,
      itemBuilder: (context, i) => switch (entries[i]) {
        CaptionEntry(:final segment) when segment.deleted => Align(
          alignment: Alignment.centerLeft,
          child: DeletedCard(
            header: '${session.displayName(segment.speakerIdentity)}(テキスト)',
            label: deletedTextLabel,
          ),
        ),
        CaptionEntry(:final segment) => GestureDetector(
          key: Key('caption-${segment.segmentId}'),
          // 長押しで消す(自分の送ったテキストだけ)
          onLongPress: session.canDeleteCaption(segment)
              ? () => onDeleteCaption(segment)
              : null,
          child: _CaptionTile(
            segment: segment,
            speaker: session.displayName(segment.speakerIdentity),
            myLanguage: session.myLanguage,
          ),
        ),
        MediaEntry(:final event) when event.deleted != null => Align(
          alignment: Alignment.centerLeft,
          child: DeletedCard(
            header:
                '${session.displayName(event.senderId)} ・ ${formatTime(event.occurredAt)}',
            label: deletedLabel(event),
          ),
        ),
        MediaEntry(:final event) => Align(
          alignment: Alignment.centerLeft,
          child: GestureDetector(
            onLongPress: session.canDeleteMedia(event)
                ? () => onDeleteMedia(event)
                : null,
            child: MediaCard(
              event: event,
              sender: session.displayName(event.senderId),
            ),
          ),
        ),
      },
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
    required this.onAttach,
  });

  final TextEditingController controller;
  final bool enabled;
  final VoidCallback onSend;
  final VoidCallback onAttach;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        children: [
          IconButton(
            key: const Key('attachMedia'),
            tooltip: '画像・動画を送る',
            icon: const Icon(Icons.add_photo_alternate_outlined),
            onPressed: enabled ? onAttach : null,
          ),
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
