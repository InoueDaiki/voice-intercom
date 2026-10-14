import 'package:flutter/material.dart';
import 'package:voice_intercom_api_client/api.dart';

/// 消したテキスト、画像、動画の表示(履歴とルームの表示で同じ言い方にする)
const deletedTextLabel = '削除されたテキスト';
const deletedImageLabel = '削除された画像';
const deletedVideoLabel = '削除された動画';

/// 墓石の行の「削除された…」
String deletedLabel(TimelineEvent event) {
  if (event.kind != TimelineEventKindEnum.media) {
    return deletedTextLabel;
  }
  return event.deleted?.mediaType == TimelineDeletionMediaTypeEnum.video
      ? deletedVideoLabel
      : deletedImageLabel;
}

/// 「削除された…」の文字。ほかと区別できるよう、斜体・薄い色・アイコンで出す
class DeletedText extends StatelessWidget {
  const DeletedText(this.label, {super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.onSurfaceVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.delete_outline, size: 16, color: color),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            label,
            key: const Key('deleted'),
            style: TextStyle(color: color, fontStyle: FontStyle.italic),
          ),
        ),
      ],
    );
  }
}

/// ルームの時間の流れに出す、消したもの1件(送信者と時刻は残す)
class DeletedCard extends StatelessWidget {
  const DeletedCard({super.key, required this.header, required this.label});

  final String header;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(header, style: theme.textTheme.labelMedium),
            DeletedText(label),
          ],
        ),
      ),
    );
  }
}

/// 長押しのメニューで「削除」を選び、確認で「削除する」を押したら true
Future<bool> confirmDeletion(BuildContext context, String what) async {
  final chosen = await showModalBottomSheet<bool>(
    context: context,
    builder: (context) => SafeArea(
      child: ListTile(
        key: const Key('deleteMenu'),
        leading: Icon(
          Icons.delete_outline,
          color: Theme.of(context).colorScheme.error,
        ),
        title: Text('この$whatを削除'),
        onTap: () => Navigator.of(context).pop(true),
      ),
    ),
  );
  if (chosen != true || !context.mounted) {
    return false;
  }
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text('$whatを削除しますか?'),
      content: Text(
        'ルームの全員の表示と履歴が「削除された$what」に変わります。'
        '元に戻せません。届いた通知は消えません。',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('やめる'),
        ),
        TextButton(
          key: const Key('confirmDelete'),
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('削除する'),
        ),
      ],
    ),
  );
  return confirmed == true;
}

/// 消す種類の言い方(メニューと確認に使う)
String deletionWhat(TimelineEvent event) {
  final media = event.media;
  if (event.kind != TimelineEventKindEnum.media) {
    return 'テキスト';
  }
  return media?.contentType == TimelineMediaContentTypeEnum.videoSlashMp4
      ? '動画'
      : '画像';
}
