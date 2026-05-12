// Settings-Screen · API-keys + setup-status.
// Spiegelt desktop-app/settings_modal.jsx. Endpoints:
//   GET  /api/setup/status
//   POST /api/setup/settings { key, value }
//   POST /api/setup/install-claude
//
// Mobile-spezifisch: alle inputs obscure-text, paste-friendly. Falls
// claude-cli am server fehlt → button „auto-install" verfügbar.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../theme.dart';
import '../sync_client.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

const _keyMeta = <String, Map<String, String>>{
  'ANTHROPIC_API_KEY': {
    'label': 'Anthropic API-key',
    'hint': 'alternative zu `claude login`. format: sk-ant-…',
  },
  'REF_API_KEY': {
    'label': 'ref-tools-mcp',
    'hint': 'aktiviert ref-tools-mcp (ref.tools). ohne key wird der server zur laufzeit gefiltert.',
  },
  'CONTEXT7_API_KEY': {
    'label': 'context7-mcp',
    'hint': 'höhere quota für context7. ohne key läuft er auf basic-tier.',
  },
  'OPENAI_API_KEY': {
    'label': 'OpenAI API-key',
    'hint': 'für eigene agents/tools. von ProjectGamma nicht direkt verwendet.',
  },
  'GITHUB_PERSONAL_ACCESS_TOKEN': {
    'label': 'GitHub PAT',
    'hint': 'github-mcp: repo-zugriff, PRs, issues. token in github.com/settings/tokens',
  },
};

class _SettingsScreenState extends State<SettingsScreen> {
  Map<String, dynamic>? _status;
  String? _error;
  bool _loading = true;
  bool _busy = false;
  bool _installing = false;
  String? _installLog;
  final Map<String, TextEditingController> _ctrl = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    for (final c in _ctrl.values) { c.dispose(); }
    super.dispose();
  }

  TextEditingController _ctrlFor(String key) =>
      _ctrl.putIfAbsent(key, () => TextEditingController());

  Future<void> _load() async {
    final c = SyncClientScope.of(context, listen: false);
    final url = c.serverUrl;
    if (url == null) {
      setState(() { _loading = false; _error = 'kein server verbunden'; });
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final r = await http.get(
        Uri.parse('$url/api/setup/status'),
        headers: c.authHeader,
      ).timeout(const Duration(seconds: 5));
      if (r.statusCode != 200) throw Exception('http ${r.statusCode}');
      setState(() { _status = jsonDecode(r.body); _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString().replaceFirst('Exception: ', ''); });
    }
  }

  Future<void> _save(String key) async {
    final value = _ctrlFor(key).text;
    if (value.isEmpty) return;
    setState(() { _busy = true; _error = null; });
    final c = SyncClientScope.of(context, listen: false);
    try {
      final r = await http.post(
        Uri.parse('${c.serverUrl}/api/setup/settings'),
        headers: {...c.authHeader, 'content-type': 'application/json'},
        body: jsonEncode({'key': key, 'value': value}),
      ).timeout(const Duration(seconds: 5));
      final data = jsonDecode(r.body);
      if (r.statusCode != 200) throw Exception(data['error'] ?? 'fehler');
      _ctrlFor(key).clear();
      setState(() { _status!['settings'] = data['settings']; });
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clear(String key) async {
    setState(() { _busy = true; _error = null; });
    final c = SyncClientScope.of(context, listen: false);
    try {
      final r = await http.post(
        Uri.parse('${c.serverUrl}/api/setup/settings'),
        headers: {...c.authHeader, 'content-type': 'application/json'},
        body: jsonEncode({'key': key, 'value': ''}),
      ).timeout(const Duration(seconds: 5));
      final data = jsonDecode(r.body);
      if (r.statusCode != 200) throw Exception(data['error'] ?? 'fehler');
      setState(() { _status!['settings'] = data['settings']; });
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _installClaude() async {
    setState(() { _installing = true; _installLog = 'läuft… kann ~30s dauern'; });
    final c = SyncClientScope.of(context, listen: false);
    try {
      final r = await http.post(
        Uri.parse('${c.serverUrl}/api/setup/install-claude'),
        headers: c.authHeader,
      ).timeout(const Duration(seconds: 120));
      final data = jsonDecode(r.body);
      if (r.statusCode == 200) {
        setState(() { _installLog = '✓ installiert: ${data['version'] ?? '?'}'; });
        await _load();
      } else {
        setState(() { _installLog = '✗ fehler: ${data['error'] ?? data['err'] ?? "code ${data['code']}"}'; });
      }
    } catch (e) {
      setState(() { _installLog = '✗ ${e.toString()}'; });
    } finally {
      if (mounted) setState(() => _installing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: pgPaper,
      appBar: AppBar(
        backgroundColor: pgPaper, elevation: 0,
        iconTheme: const IconThemeData(color: pgInk),
        title: const Text('einstellungen', style: TextStyle(color: pgInk, fontSize: 16)),
        actions: [
          IconButton(
            tooltip: 'aktualisieren',
            icon: const Icon(Icons.refresh, color: pgInk),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: pgInk));
    if (_status == null) {
      return Center(child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.error_outline, size: 48, color: pgInkFaint),
          const SizedBox(height: 12),
          Text(_error ?? 'fehler', textAlign: TextAlign.center,
            style: const TextStyle(color: pgDanger, fontSize: 13)),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: _load, child: const Text('erneut versuchen')),
        ]),
      ));
    }
    // Defensive (audit-fix): server kann partial response liefern, dann nicht crashen
    final claude = (_status!['claude'] is Map ? _status!['claude'] as Map : const {});
    final settings = (_status!['settings'] is Map ? _status!['settings'] as Map : const {});
    final knownKeys = (_status!['knownKeys'] is List
        ? (_status!['knownKeys'] as List).whereType<String>().toList()
        : <String>[]);
    final installed = claude['installed'] == true;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        const PgEyebrow('claude-cli status'),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            border: Border.all(color: pgInk, width: 2),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(children: [
            Text(installed ? '✓' : '✗', style: const TextStyle(fontSize: 20)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(installed ? 'installiert · ${claude['version']}' : 'nicht gefunden',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600,
                      color: installed ? pgInk : pgDanger)),
                  if (installed && claude['path'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(claude['path'].toString(),
                        style: const TextStyle(fontSize: 10, color: pgInkSoft, fontFamily: 'monospace')),
                    ),
                  if (!installed && claude['error'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(claude['error'].toString(),
                        style: const TextStyle(fontSize: 11, color: pgInkSoft)),
                    ),
                ],
              ),
            ),
            if (!installed)
              ElevatedButton(
                onPressed: _installing ? null : _installClaude,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                ),
                child: Text(_installing ? '…' : 'install',
                  style: const TextStyle(fontSize: 12)),
              ),
          ]),
        ),
        if (_installLog != null) Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              border: Border.all(color: pgInkFaint, width: 1, style: BorderStyle.solid),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(_installLog!, style: const TextStyle(fontSize: 11, fontFamily: 'monospace')),
          ),
        ),
        const SizedBox(height: 6),
        const Text(
          'tipp: erstmal `claude login` im terminal — verwendet deinen Anthropic-account. '
          'alternativ unten den API-key eintragen.',
          style: TextStyle(fontSize: 11, color: pgInkFaint, height: 1.5),
        ),
        const SizedBox(height: 20),

        const PgEyebrow('API-keys'),
        const SizedBox(height: 6),
        for (final key in knownKeys) _buildKeyField(key, settings[key]?.toString() ?? 'unset'),

        if (_error != null) ...[
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              border: Border.all(color: pgDanger, width: 1.5),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(_error!, style: const TextStyle(color: pgDanger, fontSize: 13)),
          ),
        ],

        const SizedBox(height: 16),
        const Text(
          'keys werden in sync-server/user_settings.json gespeichert (klartext, lokal). '
          'beim claude+MCP-spawn werden sie als env-vars injiziert.',
          style: TextStyle(fontSize: 10.5, color: pgInkFaint, height: 1.5),
        ),
      ],
    );
  }

  Widget _buildKeyField(String key, String maskedValue) {
    final meta = _keyMeta[key] ?? const {'label': '?', 'hint': ''};
    final isSet = maskedValue != 'unset';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          border: Border.all(color: pgInkFaint, width: 1.5),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(child: Text(meta['label']!,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: isSet ? pgInk : pgPaper,
                  border: Border.all(color: pgInk, width: 1.5),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(maskedValue, style: TextStyle(
                  color: isSet ? pgPaper : pgInk,
                  fontFamily: 'monospace', fontSize: 9.5,
                )),
              ),
            ]),
            const SizedBox(height: 4),
            Text(key, style: const TextStyle(fontSize: 10, color: pgInkFaint, fontFamily: 'monospace')),
            const SizedBox(height: 4),
            Text(meta['hint']!, style: const TextStyle(fontSize: 11, color: pgInkSoft, height: 1.4)),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: TextField(
                  controller: _ctrlFor(key),
                  obscureText: true,
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                  decoration: InputDecoration(
                    hintText: isSet ? 'neuen wert eingeben um zu ändern' : 'key eingeben…',
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              ElevatedButton(
                onPressed: _busy ? null : () => _save(key),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('✓', style: TextStyle(fontSize: 14)),
              ),
              if (isSet) ...[
                const SizedBox(width: 4),
                OutlinedButton(
                  onPressed: _busy ? null : () => _clear(key),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: pgDanger,
                    side: const BorderSide(color: pgDanger, width: 1.5),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  child: const Text('×', style: TextStyle(fontSize: 14)),
                ),
              ],
            ]),
          ],
        ),
      ),
    );
  }
}
