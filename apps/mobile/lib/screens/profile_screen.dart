import 'package:flutter/material.dart';

import '../app_state.dart';
import '../languages.dart';

/// プロフィール(表示名と言語)の登録。言語で翻訳先が決まるので、登録するまで入室できない。
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.state});

  final AppState state;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final TextEditingController _name = TextEditingController(
    text: widget.state.profile?.displayName ?? '',
  );
  late String _language = widget.state.profile?.language.toJson() ?? 'ja';
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      return;
    }
    setState(() => _busy = true);
    await widget.state.saveProfile(name, _language);
    if (mounted) {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = widget.state.error;
    return Scaffold(
      appBar: AppBar(
        title: const Text('プロフィール'),
        actions: [
          TextButton(
            onPressed: widget.state.signOut,
            child: const Text('ログアウト'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            key: const Key('displayName'),
            controller: _name,
            decoration: const InputDecoration(labelText: '表示名'),
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            key: const Key('language'),
            initialValue: _language,
            decoration: const InputDecoration(labelText: '話す言語(この言語で聞く)'),
            items: [
              for (final e in languageNames.entries)
                DropdownMenuItem(value: e.key, child: Text(e.value)),
            ],
            onChanged: (v) => setState(() => _language = v ?? _language),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: const Text('登録'),
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
    );
  }
}
