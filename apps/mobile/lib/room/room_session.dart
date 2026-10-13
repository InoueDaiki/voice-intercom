import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:voice_intercom_api_client/api.dart' show TimelineEvent;
import 'package:voice_intercom_schema/gen/voiceintercom/v1/caption.pb.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/text.pb.dart';

import 'background_audio.dart';
import 'caption_board.dart';
import 'media_feed.dart';
import 'media_receiver.dart';
import 'subscription.dart';
import 'text_sender.dart';

/// データチャネルの topic(proto/voiceintercom/v1 のコメント)
const captionTopic = 'caption';
const textTopic = 'text';

/// 画像・動画の配信(設計メモの「データチャネルの取り決め」)。API が Server API から送る
const mediaTopic = 'media';

/// 1つのルームへの接続。PTT、購読、字幕、テキスト入力を受け持つ。
class RoomSession extends ChangeNotifier {
  RoomSession({
    required this.myIdentity,
    required this.myLanguage,
    required this.roomName,
    this.backgroundAudio = const BackgroundAudio(),
    Future<List<TimelineEvent>> Function()? fetchRecentTimeline,
  }) {
    // Agent を知ってから送る。知る前に Agent が返した字幕は捨てるため(TextSender)
    textSender = TextSender(
      send: _sendText,
      onChanged: _changed,
      canSend: () => agentPresent,
    );
    final fetch = fetchRecentTimeline;
    if (fetch != null) {
      mediaReceiver = MediaReceiver(
        fetchRecent: fetch,
        onConfirmed: addMedia,
        isKnown: media.contains,
      );
    }
  }

  // WebRTC の初期化はアプリで1回だけ
  static final Future<void> _webrtcReady = LiveKitClient.initialize();

  /// 自分の LiveKit identity(Cognito の sub。API がトークンに入れる)
  final String myIdentity;

  /// 自分の言語。この言語の翻訳音声と訳の字幕を受け取る
  final String myLanguage;

  /// ルームの名前。入室中の通知に出す
  final String roomName;

  /// 入室中はバックグラウンドでも音声を保つ
  final BackgroundAudio backgroundAudio;

  final Room room = Room(
    roomOptions: const RoomOptions(
      // 音声だけなので、映像の最適化は要らない
      adaptiveStream: false,
      dynacast: false,
    ),
  );
  final CaptionBoard captions = CaptionBoard();

  /// ルームの画面に出す画像・動画
  final MediaFeed media = MediaFeed();

  /// topic `media` の受け手。履歴を読めないとき(fetchRecentTimeline を渡さないとき)は null で、
  /// topic `media` を捨てる
  MediaReceiver? mediaReceiver;

  /// つなぎ直したときに呼ぶ(履歴を読み直して、切れていた間の画像・動画を埋める)
  void Function()? onReconnected;
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
        ..on<ParticipantConnectedEvent>((e) {
          if (e.participant.kind == ParticipantKind.AGENT) {
            textSender.resume();
          }
          _changed();
        })
        ..on<ParticipantDisconnectedEvent>((_) => _changed())
        ..on<TrackSubscribedEvent>((_) => _changed())
        ..on<RoomReconnectedEvent>((_) => onReconnected?.call())
        ..on<RoomDisconnectedEvent>((e) {
          connected = false;
          talking = false;
          _stopBackground();
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
        _warn('ミュートのモードを設定できなかった(OS のミュート音が鳴ることがある)');
      }
      // マイクの権限を得た後(publish の後)に始める。権限が無いとマイクのサービスにできない
      await _startBackground();
      connected = true;
      _changed();
    } catch (e) {
      _stopBackground();
      error = '入室できなかった: $e';
      _changed();
      rethrow;
    }
  }

  void _warn(String message) {
    warning = warning == null ? message : '$warning\n$message';
  }

  /// バックグラウンドでの音声を保つ。始められなくても入室は止めない(前面にいる間は使える)
  Future<void> _startBackground() async {
    if (_disposed) {
      return;
    }
    try {
      final withMic = await backgroundAudio.start('$roomName に入室中');
      if (!withMic) {
        _warn('マイクの権限が無いので、バックグラウンドでは受信だけになる');
      }
    } catch (e) {
      debugPrint('バックグラウンドの音声を始められなかった: $e');
      _warn('バックグラウンドに回ると音声が止まることがある');
    }
  }

  void _stopBackground() {
    unawaited(
      backgroundAudio.stop().catchError(
        (Object e) => debugPrint('バックグラウンドの音声を止められなかった: $e'),
      ),
    );
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

  /// 送信元が Agent の参加者か。kind は LiveKit サーバーが配る参加者の情報(ParticipantInfo)から
  /// SDK が入れるもので、送信元の参加者もサーバーが付ける identity で引くので、参加者は偽れない
  @visibleForTesting
  static bool isFromAgent(RemoteParticipant? sender) =>
      sender?.kind == ParticipantKind.AGENT;

  /// データチャネルで受け取ったもの(テストでは Room を通さずに渡す)
  @visibleForTesting
  void handleData(DataReceivedEvent e) => _onData(e);

  void _onData(DataReceivedEvent e) {
    if (e.topic == mediaTopic) {
      // 送信元の参加者があるものは捨て、無いものも履歴で確かめてから出す(MediaReceiver)
      final result = mediaReceiver?.receive(
        e.data,
        fromParticipant: e.participant != null,
      );
      if (result == MediaReceiveResult.fromParticipant) {
        debugPrint('参加者が送った topic media を捨てた: ${e.participant?.identity}');
      }
      return;
    }
    if (e.topic != captionTopic) {
      return;
    }
    // 字幕は Agent だけが送る。参加者は topic を偽れる(canPublishData は topic を限れない)ので、
    // 送信元が Agent の参加者のものだけを読む。受け手が Agent を知る前(Agent が入ってから約3秒)に
    // 届いたものは送信元が null で、これも捨てる(設計メモの「字幕の送信元」)
    if (!isFromAgent(e.participant)) {
      debugPrint('Agent 以外が送った topic caption を捨てた: ${e.participant?.identity}');
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

  /// 画像・動画を足す(complete の応答、履歴)。event_id で重ねない
  void addMedia(Iterable<TimelineEvent> events) {
    if (media.addAll(events)) {
      _changed();
    }
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
    _stopBackground();
    textSender.dispose();
    mediaReceiver?.dispose();
    unawaited(_listener?.dispose());
    unawaited(room.disconnect().then((_) => room.dispose()));
    super.dispose();
  }
}
