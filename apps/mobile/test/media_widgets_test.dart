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

  testWidgets('画像は送信者・時刻・添えた文を出し、タップで全画面に開く', (tester) async {
    final event = mediaEvent(
      '2026-10-13T00:00:00.000Z',
      sourceId: 'img1',
      thumbnailUrl: 'https://media.example/rooms/r1/img1/thumbnail',
      text: '入荷した箱',
    );
    await tester.pumpWidget(app(MediaCard(event: event, sender: 'ボブ')));
    expect(find.textContaining('ボブ(画像)'), findsOneWidget);
    expect(find.text('入荷した箱'), findsOneWidget);
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
    expect(viewer.caption, '入荷した箱');
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
