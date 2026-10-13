import 'package:flutter_test/flutter_test.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:voice_intercom/room/room_session.dart';

import 'media_receiver_test.dart' show messageFor;
import 'support/media_fixtures.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('topic media は履歴で確かめてからルームの表示に足す', () async {
    final row = mediaEvent('2026-10-13T00:00:01.000Z', senderId: 'bob');
    var fetches = 0;
    final session = RoomSession(
      myIdentity: 'alice',
      myLanguage: 'ja',
      roomName: 'r',
      fetchRecentTimeline: () async {
        fetches++;
        return [row];
      },
    );
    var notified = 0;
    session.addListener(() => notified++);

    // ほかの topic には MediaMessage を読ませない
    session.handleData(
      DataReceivedEvent(
        participant: null,
        data: messageFor(row),
        topic: 'text',
      ),
    );
    session.handleData(
      DataReceivedEvent(
        participant: null,
        data: messageFor(row),
        topic: mediaTopic,
      ),
    );
    await pumpEventQueue();
    expect(fetches, 1);
    expect(session.media.items.single.eventId, row.eventId);
    expect(notified, 1);

    // complete のやり直しで同じものが届いても、読まずに捨てる
    session.handleData(
      DataReceivedEvent(
        participant: null,
        data: messageFor(row),
        topic: mediaTopic,
      ),
    );
    await pumpEventQueue();
    expect(fetches, 1);
    expect(session.media.items, hasLength(1));
  });

  test('履歴を読めない作りでは topic media を捨てる', () async {
    final session = RoomSession(
      myIdentity: 'alice',
      myLanguage: 'ja',
      roomName: 'r',
    );
    final row = mediaEvent('2026-10-13T00:00:01.000Z');
    session.handleData(
      DataReceivedEvent(
        participant: null,
        data: messageFor(row),
        topic: mediaTopic,
      ),
    );
    await pumpEventQueue();
    expect(session.media.items, isEmpty);
  });
}
