import 'package:flutter/material.dart';
import 'package:voice_intercom_api_client/api.dart';

import '../media/media_uploader.dart';
import 'media_viewer_screen.dart';

bool isVideoMedia(TimelineMedia media) =>
    media.contentType == TimelineMediaContentTypeEnum.videoSlashMp4;

/// 一覧で読む画像の URL。サムネイルがあればそれ、無ければ画像は本体、動画は null(枠だけ)。
/// 本体はタップしてから読む(設計メモの「サムネイル」)。
String? previewUrl(TimelineMedia media) {
  final thumbnail = media.thumbnailUrl;
  if (thumbnail != null && thumbnail.isNotEmpty) {
    return thumbnail;
  }
  return isVideoMedia(media) ? null : media.url;
}

/// 履歴の時刻(ISO 8601)を、端末の時刻の「月/日 時:分」にする
String formatTime(String iso) {
  final t = DateTime.tryParse(iso)?.toLocal();
  if (t == null) {
    return iso;
  }
  String two(int v) => v.toString().padLeft(2, '0');
  return '${t.month}/${t.day} ${two(t.hour)}:${two(t.minute)}';
}

void openMediaViewer(BuildContext context, TimelineEvent event) {
  final media = event.media;
  if (media == null) {
    return;
  }
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => MediaViewerScreen(media: media, caption: event.text),
    ),
  );
}

/// 画像・動画のサムネイル。タップで全画面の表示・再生を開く。
class MediaThumbnail extends StatelessWidget {
  const MediaThumbnail({
    super.key,
    required this.event,
    this.width = 200,
    this.height = 150,
  });

  final TimelineEvent event;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final media = event.media!;
    final scheme = Theme.of(context).colorScheme;
    final url = previewUrl(media);
    final video = isVideoMedia(media);
    Widget placeholder(IconData icon) => ColoredBox(
      color: scheme.surfaceContainerHighest,
      child: Center(child: Icon(icon, color: scheme.onSurfaceVariant)),
    );
    return Semantics(
      button: true,
      label: video ? '動画を再生する' : '画像を開く',
      child: InkWell(
        key: Key('media-${media.mediaId}'),
        onTap: () => openMediaViewer(context, event),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: width,
            height: height,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (url == null)
                  placeholder(Icons.movie_outlined)
                else
                  Image.network(
                    url,
                    fit: BoxFit.cover,
                    // 一覧の大きさに縮めてから持つ(メモリを抑える)
                    cacheWidth: (width * MediaQuery.devicePixelRatioOf(context))
                        .round(),
                    loadingBuilder: (context, child, progress) =>
                        progress == null
                        ? child
                        : placeholder(Icons.hourglass_empty),
                    errorBuilder: (context, error, stack) =>
                        placeholder(Icons.broken_image_outlined),
                  ),
                if (video)
                  const Center(
                    child: Icon(
                      Icons.play_circle_fill,
                      size: 48,
                      color: Colors.white70,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// ルームの時間の流れに出す画像・動画1件。送信者、時刻、サムネイル、添えた文。
class MediaCard extends StatelessWidget {
  const MediaCard({super.key, required this.event, required this.sender});

  final TimelineEvent event;
  final String sender;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final video = isVideoMedia(event.media!);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$sender(${video ? '動画' : '画像'}) ・ ${formatTime(event.occurredAt)}',
              style: theme.textTheme.labelMedium,
            ),
            const SizedBox(height: 4),
            MediaThumbnail(event: event),
            if (event.text.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(event.text),
            ],
          ],
        ),
      ),
    );
  }
}

/// 送信中の画像・動画。送信者の画面にだけ出す。失敗したらやり直せる。
class OutgoingMediaList extends StatelessWidget {
  const OutgoingMediaList({
    super.key,
    required this.items,
    required this.onRetry,
    required this.onDismiss,
  });

  final List<OutgoingMedia> items;
  final void Function(OutgoingMedia item) onRetry;
  final void Function(OutgoingMedia item) onDismiss;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const SizedBox.shrink();
    }
    return Column(
      children: [for (final item in items) _OutgoingMediaTile(item, this)],
    );
  }
}

class _OutgoingMediaTile extends StatelessWidget {
  const _OutgoingMediaTile(this.item, this.list);

  final OutgoingMedia item;
  final OutgoingMediaList list;

  @override
  Widget build(BuildContext context) {
    final progress = item.progress;
    final percent = progress == null ? '' : ' ${(progress * 100).round()}%';
    final kind = item.prepared == null
        ? '画像・動画'
        : item.isVideo
        ? '動画'
        : '画像';
    final String label = switch (item.state) {
      OutgoingMediaState.preparing => '$kindを圧縮中$percent',
      OutgoingMediaState.uploading => '$kindを送信中$percent',
      OutgoingMediaState.completing => '$kindを保存中',
      OutgoingMediaState.done => '$kindを送った',
      OutgoingMediaState.failed => '送れなかった: ${item.error ?? ''}',
    };
    final failed = item.state == OutgoingMediaState.failed;
    return ListTile(
      key: Key('outgoing-${item.localId}'),
      dense: true,
      leading: Icon(
        failed
            ? Icons.error_outline
            : item.isVideo
            ? Icons.movie_outlined
            : Icons.image_outlined,
        color: failed ? Theme.of(context).colorScheme.error : null,
      ),
      title: Text(label),
      subtitle: failed ? null : LinearProgressIndicator(value: progress),
      trailing: failed
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (item.retryable)
                  TextButton(
                    key: Key('retry-${item.localId}'),
                    onPressed: () => list.onRetry(item),
                    child: const Text('やり直す'),
                  ),
                IconButton(
                  key: Key('dismiss-${item.localId}'),
                  tooltip: '取りやめる',
                  icon: const Icon(Icons.close),
                  onPressed: () => list.onDismiss(item),
                ),
              ],
            )
          : null,
    );
  }
}
