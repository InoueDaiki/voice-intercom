import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:voice_intercom_api_client/api.dart';

import 'media_widgets.dart';

/// 画像を全画面で出す(つまんで拡大できる)か、動画を再生する。
class MediaViewerScreen extends StatelessWidget {
  const MediaViewerScreen({super.key, required this.media, this.caption = ''});

  final TimelineMedia media;

  /// 添えた文
  final String caption;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: isVideoMedia(media)
                  ? _VideoView(url: media.url)
                  : _ImageView(url: media.url),
            ),
            if (caption.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(
                  caption,
                  style: const TextStyle(color: Colors.white),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ImageView extends StatelessWidget {
  const _ImageView({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    return InteractiveViewer(
      maxScale: 5,
      child: Center(
        child: Image.network(
          url,
          fit: BoxFit.contain,
          loadingBuilder: (context, child, progress) {
            if (progress == null) {
              return child;
            }
            final total = progress.expectedTotalBytes;
            return CircularProgressIndicator(
              value: total == null
                  ? null
                  : progress.cumulativeBytesLoaded / total,
            );
          },
          errorBuilder: (context, error, stack) =>
              const Text('画像を読めなかった', style: TextStyle(color: Colors.white)),
        ),
      ),
    );
  }
}

/// CloudFront の URL をそのまま渡し、読みながら再生する(設計メモの「動画の再生」)。
class _VideoView extends StatefulWidget {
  const _VideoView({required this.url});

  final String url;

  @override
  State<_VideoView> createState() => _VideoViewState();
}

class _VideoViewState extends State<_VideoView> {
  late final VideoPlayerController _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller.addListener(_onChanged);
    _controller.initialize().then((_) => _controller.play()).catchError((
      Object e,
    ) {
      if (mounted) {
        setState(() => _error = '動画を再生できなかった: $e');
      }
    });
  }

  void _onChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _controller.removeListener(_onChanged);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final error = _error ?? _controller.value.errorDescription;
    if (error != null) {
      return Center(
        child: Text(error, style: const TextStyle(color: Colors.white)),
      );
    }
    final value = _controller.value;
    if (!value.isInitialized) {
      return const Center(child: CircularProgressIndicator());
    }
    return Column(
      children: [
        Expanded(
          child: Center(
            child: AspectRatio(
              aspectRatio: value.aspectRatio,
              child: GestureDetector(
                onTap: () =>
                    value.isPlaying ? _controller.pause() : _controller.play(),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    VideoPlayer(_controller),
                    if (!value.isPlaying)
                      const Icon(
                        Icons.play_circle_fill,
                        size: 64,
                        color: Colors.white70,
                      ),
                    if (value.isBuffering) const CircularProgressIndicator(),
                  ],
                ),
              ),
            ),
          ),
        ),
        VideoProgressIndicator(
          _controller,
          allowScrubbing: true,
          padding: const EdgeInsets.all(16),
        ),
      ],
    );
  }
}
