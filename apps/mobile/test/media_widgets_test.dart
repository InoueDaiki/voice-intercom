import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_intercom/media/media_preparer.dart';
import 'package:voice_intercom/media/media_uploader.dart';
import 'package:voice_intercom/screens/media_viewer_screen.dart';
import 'package:voice_intercom/screens/media_widgets.dart';

import 'support/media_fixtures.dart';

Widget app(Widget child) => MaterialApp(
  home: Scaffold(body: SingleChildScrollView(child: child)),
);

OutgoingMedia outgoing(
  String id,
  OutgoingMediaState state, {
  double? progress,
  String? error,
  bool retryable = true,
  bool video = false,
}) => OutgoingMedia(id, '/tmp/$id')
  ..state = state
  ..progress = progress
  ..error = error
  ..retryable = retryable
  ..prepared = state == OutgoingMediaState.preparing
      ? null
      : PreparedMedia(
          path: '/tmp/$id',
          contentType: video ? 'video/mp4' : 'image/jpeg',
          sizeBytes: 1,
          isVideo: video,
        );

void main() {
  testWidgets('送信中の段階と進み具合を出し、失敗したらやり直せる', (tester) async {
    final retried = <String>[];
    final dismissed = <String>[];
    await tester.pumpWidget(
      app(
        OutgoingMediaList(
          items: [
            outgoing('a', OutgoingMediaState.preparing, progress: 0.42),
            outgoing(
              'b',
              OutgoingMediaState.uploading,
              progress: 0.5,
              video: true,
            ),
            outgoing('c', OutgoingMediaState.completing),
            outgoing(
              'd',
              OutgoingMediaState.failed,
              error: 'アップロードできなかった(500)',
            ),
            outgoing(
              'e',
              OutgoingMediaState.failed,
              error: '動画は3分までにする',
              retryable: false,
            ),
          ],
          onRetry: (m) => retried.add(m.localId),
          onDismiss: (m) => dismissed.add(m.localId),
        ),
      ),
    );

    expect(find.text('画像・動画を圧縮中 42%'), findsOneWidget);
    expect(find.text('動画を送信中 50%'), findsOneWidget);
    expect(find.text('画像を保存中'), findsOneWidget);
    expect(find.text('送れなかった: アップロードできなかった(500)'), findsOneWidget);
    expect(find.text('送れなかった: 動画は3分までにする'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsNWidgets(3));

    // やり直せないものにはボタンを出さない
    expect(find.byKey(const Key('retry-e')), findsNothing);
    await tester.tap(find.byKey(const Key('retry-d')));
    await tester.tap(find.byKey(const Key('dismiss-e')));
    expect(retried, ['d']);
    expect(dismissed, ['e']);
  });

  testWidgets('何も送っていなければ何も出さない', (tester) async {
    await tester.pumpWidget(
      app(
        OutgoingMediaList(items: const [], onRetry: (_) {}, onDismiss: (_) {}),
      ),
    );
    expect(find.byType(ListTile), findsNothing);
  });

  testWidgets('画像は送信者・時刻を出し、タップで全画面に開く', (tester) async {
    final event = mediaEvent(
      '2026-10-13T00:00:00.000Z',
      sourceId: 'img1',
      thumbnailUrl: 'https://media.example/rooms/r1/img1/thumbnail',
      // 文を添えられたころの行が残っていても出さない(API も空にして返す)
      text: '入荷した箱',
    );
    await tester.pumpWidget(app(MediaCard(event: event, sender: 'ボブ')));
    expect(find.textContaining('ボブ(画像)'), findsOneWidget);
    expect(find.text('入荷した箱'), findsNothing);
    // 一覧ではサムネイルだけを読む
    final image = tester.widget<Image>(find.byType(Image));
    expect(
      (image.image as ResizeImage).imageProvider,
      isA<NetworkImage>().having(
        (p) => p.url,
        'url',
        'https://media.example/rooms/r1/img1/thumbnail',
      ),
    );
    expect(find.byIcon(Icons.play_circle_fill), findsNothing);

    await tester.tap(find.byKey(const Key('media-img1')));
    await tester.pumpAndSettle();
    final viewer = tester.widget<MediaViewerScreen>(
      find.byType(MediaViewerScreen),
    );
    expect(viewer.media.url, 'https://media.example/rooms/r1/img1/original');
    expect(find.text('入荷した箱'), findsNothing);
    expect(find.byType(InteractiveViewer), findsOneWidget);
  });

  testWidgets('サムネイルの無い動画は枠と再生のしるしだけ', (tester) async {
    final event = mediaEvent(
      '2026-10-13T00:00:00.000Z',
      sourceId: 'v1',
      video: true,
    );
    await tester.pumpWidget(app(MediaCard(event: event, sender: '自分')));
    expect(find.textContaining('自分(動画)'), findsOneWidget);
    expect(find.byType(Image), findsNothing);
    expect(find.byIcon(Icons.movie_outlined), findsOneWidget);
    expect(find.byIcon(Icons.play_circle_fill), findsOneWidget);
    // 長さの分からない動画(足す前に保存した履歴)には長さを出さない
    expect(find.byKey(const Key('duration-v1')), findsNothing);
  });

  testWidgets('縦長の動画は縦長の枠を先に取り、長さを出す', (tester) async {
    final event = mediaEvent(
      '2026-10-13T00:00:00.000Z',
      sourceId: 'v2',
      video: true,
      width: 720,
      height: 1280,
      durationMs: 75000,
    );
    await tester.pumpWidget(app(MediaCard(event: event, sender: '自分')));
    final box = tester.getSize(find.byKey(const Key('media-v2')));
    expect(box.height, 240);
    expect(box.width, closeTo(240 * 720 / 1280, 0.01));
    expect(find.text('1:15'), findsOneWidget);
  });

  testWidgets('幅・高さの無い画像(足す前に保存した履歴)は決まった枠で出す', (tester) async {
    final event = mediaEvent('2026-10-13T00:00:00.000Z', sourceId: 'old');
    await tester.pumpWidget(app(MediaCard(event: event, sender: 'ボブ')));
    expect(
      tester.getSize(find.byKey(const Key('media-old'))),
      const Size(200, 150),
    );
  });

  test('枠の大きさ', () {
    Size box({int? width, int? height}) => mediaBoxSize(
      mediaEvent(
        '2026-10-13T00:00:00.000Z',
        width: width,
        height: height,
      ).media!,
    );
    expect(box(width: 1600, height: 1200), const Size(240, 180));
    expect(box(width: 1000, height: 1000), const Size(240, 240));
    // 極端に細長いものは 3:1 で止める
    expect(box(width: 10000, height: 100), const Size(240, 80));
    expect(box(width: 100, height: 10000), const Size(80, 240));
    expect(box(), const Size(200, 150));
  });

  test('動画の長さの表示', () {
    expect(formatDuration(400), '0:01');
    expect(formatDuration(15000), '0:15');
    expect(formatDuration(15001), '0:16');
    expect(formatDuration(180000), '3:00');
    expect(formatDuration(3723000), '1:02:03');
    expect(
      durationLabel(
        mediaEvent(
          '2026-10-13T00:00:00.000Z',
          video: true,
          durationMs: 9000,
        ).media!,
      ),
      '0:09',
    );
    // 画像には出さない
    expect(
      durationLabel(
        mediaEvent('2026-10-13T00:00:00.000Z', durationMs: 9000).media!,
      ),
      isNull,
    );
  });

  test('一覧で読む URL', () {
    expect(
      previewUrl(mediaEvent('2026-10-13T00:00:00.000Z', sourceId: 'a').media!),
      'https://media.example/rooms/r1/a/original',
    );
    expect(
      previewUrl(
        mediaEvent(
          '2026-10-13T00:00:00.000Z',
          video: true,
          thumbnailUrl: 't',
        ).media!,
      ),
      't',
    );
    expect(
      previewUrl(mediaEvent('2026-10-13T00:00:00.000Z', video: true).media!),
      isNull,
    );
  });
}
