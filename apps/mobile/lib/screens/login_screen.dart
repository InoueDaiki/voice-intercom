import 'package:flutter/material.dart';

import '../app_state.dart';
import '../config.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.state});

  final AppState state;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _busy = false;

  Future<void> _signIn() async {
    setState(() => _busy = true);
    await widget.state.signIn();
    if (mounted) {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = widget.state.error;
    return Scaffold(
      appBar: AppBar(title: const Text('Voice Intercom')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            FilledButton(
              onPressed: _busy ? null : _signIn,
              child: const Text('ログイン'),
            ),
            const SizedBox(height: 8),
            Text(
              AppConfig.oidcIssuer,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if (error != null) ...[
              const SizedBox(height: 16),
              Text(
                error,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
