import 'package:flutter/material.dart';

import 'app_state.dart';
import 'config.dart';
import 'screens/login_screen.dart';
import 'screens/profile_screen.dart';
import 'screens/rooms_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState();
  if (AppConfig.missing.isEmpty) {
    state.start();
  }
  runApp(VoiceIntercomApp(state: state));
}

class VoiceIntercomApp extends StatelessWidget {
  const VoiceIntercomApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Voice Intercom',
      theme: ThemeData(colorSchemeSeed: Colors.teal),
      home: ListenableBuilder(
        listenable: state,
        builder: (context, _) {
          if (AppConfig.missing.isNotEmpty) {
            return _MissingConfig(AppConfig.missing);
          }
          return switch (state.stage) {
            AppStage.starting => const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            ),
            AppStage.signedOut => LoginScreen(state: state),
            AppStage.needsProfile => ProfileScreen(state: state),
            AppStage.ready => RoomsScreen(state: state),
          };
        },
      ),
    );
  }
}

class _MissingConfig extends StatelessWidget {
  const _MissingConfig(this.missing);

  final List<String> missing;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            '設定が足りない: ${missing.join('、')}\n'
            '--dart-define で渡す(apps/mobile/README.md)',
          ),
        ),
      ),
    );
  }
}
