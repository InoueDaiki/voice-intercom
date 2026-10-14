import 'package:flutter_test/flutter_test.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:voice_intercom/room/room_session.dart';
import 'package:voice_intercom/room/text_sender.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/caption.pb.dart';
import 'package:voice_intercom_schema/gen/voiceintercom/v1/text_status.pb.dart';

/// 送信元の参加者(kind と identity だけを持つ)
class _FakeParticipant extends Fake implements RemoteParticipant {
  _FakeParticipant(this.kind, this.identity);

  @override
  final ParticipantKind kind;

  @override
  final String identity;
}

DataReceivedEvent _caption(
  RemoteParticipant? sender, {
  String segmentId = 's1',
  String messageId = '',
  String speaker = 'bob',
}) => DataReceivedEvent(
  participant: sender,
  data:
      (Caption()
            ..segmentId = segmentId
            ..speakerIdentity = speaker
            ..language = 'en'
            ..text = 'hello'
            ..isFinal = true
            ..messageId = messageId)
          .writeToBuffer(),
  topic: captionTopic,
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  RoomSession newSession() =>
      RoomSession(myIdentity: 'alice', myLanguage: 'ja', roomName: 'r');

  test('送信元が Agent の参加者の字幕だけを出す', () {
    final session = newSession();
    var notified = 0;
    session.addListener(() => notified++);

    // 送信元が分からないもの(Server API から、または受け手がまだ知らない参加者から)
    session.handleData(_caption(null, segmentId: 'from-null'));
    // Agent 以外の参加者が送ったもの
    session.handleData(
      _caption(
        _FakeParticipant(ParticipantKind.STANDARD, 'mallory'),
        segmentId: 'from-standard',
      ),
    );
    expect(session.captions.segments, isEmpty);
    expect(notified, 0);

    session.handleData(
      _caption(
        _FakeParticipant(ParticipantKind.AGENT, 'agent-1'),
        segmentId: 'from-agent',
      ),
    );
    expect(session.captions.segments.single.segmentId, 'from-agent');
    expect(notified, 1);
  });

  test('Agent 以外が送った自分の message_id の字幕では、送り直しを止めない', () {
    final session = newSession();
    final id = session.textSender.submit('はい')!.messageId;

    session.handleData(
      _caption(
        _FakeParticipant(ParticipantKind.STANDARD, 'mallory'),
        messageId: id,
        speaker: 'alice',
      ),
    );
    expect(session.textSender.find(id)!.state, OutgoingTextState.sending);

    session.handleData(
      _caption(
        _FakeParticipant(ParticipantKind.AGENT, 'agent-1'),
        messageId: id,
        speaker: 'alice',
      ),
    );
    expect(session.textSender.find(id)!.state, OutgoingTextState.delivered);
    session.dispose();
  });

  test('Agent の参加者からの TextStatus だけで、送信中の表示を変える', () {
    final session = newSession();
    final id = session.textSender.submit('長い')!.messageId;
    DataReceivedEvent status(RemoteParticipant? sender) => DataReceivedEvent(
      participant: sender,
      data: TextStatus(
        messageId: id,
        state: TextStatus_State.STATE_REJECTED,
        reason: TextStatus_Reason.REASON_TOO_LONG,
      ).writeToBuffer(),
      topic: textStatusTopic,
    );

    session.handleData(status(null));
    session.handleData(
      status(_FakeParticipant(ParticipantKind.STANDARD, 'mallory')),
    );
    expect(session.textSender.find(id)!.state, OutgoingTextState.sending);

    session.handleData(status(_FakeParticipant(ParticipantKind.AGENT, 'a')));
    expect(session.textSender.find(id)!.state, OutgoingTextState.rejected);
    session.dispose();
  });
}
