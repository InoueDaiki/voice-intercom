import 'package:flutter/material.dart';
import 'package:voice_intercom_api_client/api.dart';

import '../app_state.dart';
import '../languages.dart';
import 'room_screen.dart';

/// ルームの一覧。自分がメンバーのルーム(管理者はすべて)が出る。
class RoomsScreen extends StatefulWidget {
  const RoomsScreen({super.key, required this.state});

  final AppState state;

  @override
  State<RoomsScreen> createState() => _RoomsScreenState();
}

class _RoomsScreenState extends State<RoomsScreen> {
  late Future<List<Room>> _rooms = widget.state.api.listRooms();

  Future<void> _reload() async {
    final next = widget.state.api.listRooms();
    setState(() => _rooms = next);
    await next.catchError((Object _) => <Room>[]);
  }

  Future<void> _open(Room room) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => RoomScreen(state: widget.state, room: room),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final profile = widget.state.profile;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ルーム'),
        actions: [
          IconButton(
            tooltip: 'プロフィール',
            icon: const Icon(Icons.person),
            onPressed: widget.state.editProfile,
          ),
          TextButton(
            onPressed: widget.state.signOut,
            child: const Text('ログアウト'),
          ),
        ],
      ),
      body: Column(
        children: [
          if (profile != null)
            ListTile(
              dense: true,
              title: Text(
                '${profile.displayName}(${languageName(profile.language.toJson())})',
              ),
            ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _reload,
              child: FutureBuilder<List<Room>>(
                future: _rooms,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snap.hasError) {
                    return ListView(
                      children: [
                        ListTile(title: Text('読めなかった: ${snap.error}')),
                      ],
                    );
                  }
                  final rooms = snap.data ?? [];
                  if (rooms.isEmpty) {
                    return ListView(
                      children: const [
                        ListTile(title: Text('入れるルームがない(管理コンソールでメンバーに入れてもらう)')),
                      ],
                    );
                  }
                  return ListView(
                    children: [
                      for (final room in rooms)
                        ListTile(
                          title: Text(room.name),
                          subtitle: Text(room.roomId),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => _open(room),
                        ),
                    ],
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
