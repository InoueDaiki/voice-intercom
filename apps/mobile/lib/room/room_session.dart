import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/caption.pb.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/text.pb.dart';

import 'caption_board.dart';
import 'subscription.dart';
import 'text_sender.dart';

/// データチャネルの topic(proto/voiceintercom/v1 のコメント)
const captionTopic = 'caption';
const textTopic = 'text';

/// 1つのルームへの接続。PTT、購読、字幕、テキスト入力を受け持つ。
class RoomSession extends ChangeNotifier {
  RoomSession({required this.myIdentity, required this.myLanguage}) {
    textSender = TextSender(send: _sendText, onChanged: _changed);
  }

  // WebRTC の初期化はアプリで1回だけ
  static final Future<void> _webrtcReady = LiveKitClient.initialize();

  /// 自分の LiveKit identity(Cognito の sub。API がトークンに入れる)
  final String myIdentity;

  /// 自分の言語。この言語の翻訳音声と訳の字幕を受け取る
  final String myLanguage;

  final Room room = Room(
    roomOptions: const RoomOptions(
      // 音声だけなので、映像の最適化は要らない
      adaptiveStream: false,
      dynacast: false,
    ),
  );
  final CaptionBoard captions = CaptionBoard();
  late final TextSender textSender;
  EventsListener<RoomEvent>? _listener;
  LocalAudioTrack? _mic;
  bool _disposed = false;

  bool connected = false;
  String? error;

  /// 入室はできたが、知らせておくこと
  String? warning;

  /// PTT を押しているか(利用者の操作)
  bool pressing = false;

  /// マイクのミュートが外れているか(実際の状態)
  bool talking = false;

  // ミュートの操作を順に1つずつ行うためのつなぎ
  Future<void> _micOps = Future.value();

  Future<void> connect(String url, String token) async {
    try {
      await _webrtcReady;
      var muteModeSet = await _setMuteMode();
      final listener = room.createListener();
      _listener = listener;
      listener
        ..on<TrackPublishedEvent>(
          (e) => _maybeSubscribe(e.participant, e.publication),
        )
        ..on<DataReceivedEvent>(_onData)
        ..on<ParticipantConnectedEvent>((_) => _changed())
        ..on<ParticipantDisconnectedEvent>((_) => _changed())
        ..on<TrackSubscribedEvent>((_) => _changed())
        ..on<RoomDisconnectedEvent>((e) {
          connected = false;
          talking = false;
          error ??= '切断された(${e.reason?.name ?? '理由不明'})';
          _changed();
        });
      await room.connect(
        url,
        token,
        connectOptions: const ConnectOptions(autoSubscribe: false),
      );
      for (final p in room.remoteParticipants.values) {
        for (final pub in p.audioTrackPublications) {
          _maybeSubscribe(p, pub);
        }
      }
      await _publishMuted();
      // 接続の前に設定できなかった(エンジンの準備がまだだった)ら、マイクを publish した後に
      // もう一度試す。それでもだめなら既定のモードのまま使う(ミュート音が鳴るだけで、PTT は動く)
      muteModeSet = muteModeSet || await _setMuteMode();
      if (!muteModeSet) {
        warning = 'ミュートのモードを設定できなかった(OS のミュート音が鳴ることがある)';
      }
      connected = true;
      _changed();
    } catch (e) {
      error = '入室できなかった: $e';
      _changed();
      rethrow;
    }
  }

  /// ミュートの切り替えを速く、OS のミュート音を鳴らさずに行う(iOS だけ。設計メモの「PTT の方式」)。
  /// エンジン全体の設定なので、接続の前に設定する。WebRTC を初期化してオーディオデバイスの
  /// モジュールを作ってからでないと「audio device module is unavailable」で失敗する。
  /// シミュレーターでは接続の前だと、エンジンを作り直せず -1 で失敗することがある。
  Future<bool> _setMuteMode() async {
    try {
      await AudioManager.instance.setMicrophoneMuteMode(
        MicrophoneMuteMode.inputMixer,
      );
      return true;
    } catch (e) {
      debugPrint('ミュートのモードを設定できなかった: $e');
      return false;
    }
  }

  /// マイクのトラックを、ミュートしたまま publish する。
  /// 話す間だけミュートを外す(services/agent の README の「話者のトラック」)。
  Future<void> _publishMuted() async {
    final track = await LocalAudioTrack.create(
      // ミュートで止めずに有効・無効だけを切り替え、ミュートの解除を速くする
      const AudioCaptureOptions(stopAudioCaptureOnMute: false),
    );
    // publish の前にミュートしておくと、ミュートの状態で publish される(音が漏れない)
    await track.mute(stopOnMute: false);
    await room.localParticipant!.publishAudioTrack(track);
    _mic = track;
  }

  /// PTT の押し下げ。操作は順に行い、最後の状態に揃える
  void setPressing(bool value) {
    pressing = value;
    _changed();
    _micOps = _micOps.then((_) => _applyMic()).catchError((Object e) {
      error = 'マイクを切り替えられなかった: $e';
      _changed();
    });
  }

  Future<void> _applyMic() async {
    final mic = _mic;
    if (mic == null || _disposed) {
      return;
    }
    final want = pressing && connected;
    if (want == talking) {
      return;
    }
    // ミュートの操作は必ず await する。終わる前に次の操作をすると、ミュートが効く前に音が漏れる
    // 競合がある(設計メモの「PTT の方式」)
    if (want) {
      await mic.unmute(stopOnMute: false);
    } else {
      await mic.mute(stopOnMute: false);
    }
    talking = want;
    _changed();
  }

  void _maybeSubscribe(RemoteParticipant p, RemoteTrackPublication pub) {
    final subscribe = shouldSubscribe(
      isAudio: pub.kind == TrackType.AUDIO,
      fromAgent: p.kind == ParticipantKind.AGENT,
      isMicrophone: pub.source == TrackSource.microphone,
      trackName: pub.name,
      myLanguage: myLanguage,
    );
    if (subscribe && !pub.subscribed) {
      unawaited(pub.subscribe());
    }
  }

  void _onData(DataReceivedEvent e) {
    if (e.topic != captionTopic) {
      return;
    }
    final Caption caption;
    try {
      caption = Caption.fromBuffer(e.data);
    } on Exception {
      return;
    }
    captions.apply(caption);
    if (caption.messageId.isNotEmpty && caption.speakerIdentity == myIdentity) {
      textSender.acknowledge(caption.messageId);
    }
    _changed();
  }

  Future<void> _sendText(TextMessage message) async {
    final local = room.localParticipant;
    if (local == null) {
      throw StateError('入室していない');
    }
    await local.publishData(
      message.writeToBuffer(),
      reliable: true,
      topic: textTopic,
    );
  }

  /// identity から表示名を引く。自分なら「自分」
  String displayName(String identity) {
    if (identity == myIdentity) {
      return '自分';
    }
    final p = room.remoteParticipants.values
        .where((p) => p.identity == identity)
        .firstOrNull;
    final name = p?.name ?? '';
    return name.isNotEmpty ? name : identity;
  }

  int get participantCount =>
      room.remoteParticipants.values
          .where((p) => p.kind != ParticipantKind.AGENT)
          .length +
      1;

  bool get agentPresent => room.remoteParticipants.values.any(
    (p) => p.kind == ParticipantKind.AGENT,
  );

  void _changed() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    textSender.dispose();
    unawaited(_listener?.dispose());
    unawaited(room.disconnect().then((_) => room.dispose()));
    super.dispose();
  }
}
