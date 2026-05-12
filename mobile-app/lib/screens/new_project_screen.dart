// Neues-Projekt-Screen mit AI-Scaffold-Flow.
// Spiegelt desktop NewProjectModal: 2 cc-calls (improve + scaffold).
// User → idee → ✨ verbessern (optional) → mit claude designen → preview-pick → projekt.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../theme.dart';
import '../sync_client.dart';

const _techOptions = ['flutter', 'rust', 'go', 'python', 'typescript', 'node', 'web', 'other'];

class NewProjectScreen extends StatefulWidget {
  const NewProjectScreen({super.key});
  @override
  State<NewProjectScreen> createState() => _NewProjectScreenState();
}

class _NewProjectScreenState extends State<NewProjectScreen> {
  final _name = TextEditingController();
  final _desc = TextEditingController();
  final _path = TextEditingController();
  String _tech = 'flutter';
  bool _improving = false;
  bool _scaffolding = false;
  String? _error;
  Map<String, dynamic>? _scaffold;
  final Map<String, bool> _picks = {}; // <key>-<idx> -> selected

  @override
  void dispose() {
    _name.dispose(); _desc.dispose(); _path.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>?> _scaffoldCall(String mode) async {
    final c = SyncClientScope.of(context, listen: false);
    final url = c.serverUrl;
    if (url == null) { setState(() => _error = 'kein server verbunden'); return null; }
    try {
      final r = await http.post(
        Uri.parse('$url/api/cc/scaffold'),
        headers: { ...c.authHeader, 'content-type': 'application/json' },
        body: jsonEncode({ 'mode': mode, 'description': _desc.text, 'name': _name.text }),
      ).timeout(const Duration(seconds: 60));
      final data = jsonDecode(r.body);
      if (r.statusCode != 200) throw Exception(data['error'] ?? 'fehler ${r.statusCode}');
      return data as Map<String, dynamic>;
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      return null;
    }
  }

  Future<void> _improve() async {
    if (_desc.text.trim().isEmpty) return;
    setState(() { _improving = true; _error = null; });
    final data = await _scaffoldCall('improve');
    if (data != null) {
      setState(() {
        _desc.text = (data['description'] ?? _desc.text).toString();
        if (data['techStack'] != null && data['techStack'] != 'other' && _techOptions.contains(data['techStack'])) {
          _tech = data['techStack'].toString();
        }
      });
    }
    if (mounted) setState(() => _improving = false);
  }

  Future<void> _doScaffold() async {
    if (_name.text.trim().isEmpty || _desc.text.trim().isEmpty) return;
    setState(() { _scaffolding = true; _error = null; });
    final data = await _scaffoldCall('scaffold');
    if (data != null) {
      _picks.clear();
      for (final cat in ['goals', 'rules', 'tasks', 'files']) {
        final list = (data[cat] as List?) ?? const [];
        for (int i = 0; i < list.length; i++) {
          _picks['$cat-$i'] = true;
        }
      }
      setState(() => _scaffold = data);
    }
    if (mounted) setState(() => _scaffolding = false);
  }

  Future<void> _create({bool useScaffold = false}) async {
    final name = _name.text.trim();
    if (name.isEmpty) { setState(() => _error = 'name fehlt'); return; }
    final c = SyncClientScope.of(context, listen: false);
    final now = DateTime.now().millisecondsSinceEpoch;
    final project = <String, dynamic>{
      'name': name,
      'description': _desc.text.trim(),
      'tech': _tech,
      'path': _path.text.trim(),
      'starred': false, 'lastSync': now,
      'goals': <String>[], 'files': <Map<String, dynamic>>[],
      'tasks': <Map<String, dynamic>>[], 'rules': <Map<String, dynamic>>[],
      'ideas': <Map<String, dynamic>>[], 'activity': <Map<String, dynamic>>[],
    };
    if (useScaffold && _scaffold != null) {
      project['goals'] = ((_scaffold!['goals'] as List?) ?? const [])
        .asMap().entries.where((e) => _picks['goals-${e.key}'] != false)
        .map((e) => e.value.toString()).toList();
      project['rules'] = ((_scaffold!['rules'] as List?) ?? const [])
        .asMap().entries.where((e) => _picks['rules-${e.key}'] != false)
        .map((e) {
          final r = e.value as Map;
          return { 'category': r['category'], 'text': r['text'], 'active': true };
        }).toList();
      project['tasks'] = ((_scaffold!['tasks'] as List?) ?? const [])
        .asMap().entries.where((e) => _picks['tasks-${e.key}'] != false)
        .map((e) {
          final t = e.value as Map;
          return {
            'title': t['title'], 'group': t['group'], 'meta': t['meta'],
            'priority': t['priority'], 'done': false, 'subtasks': <Map<String, dynamic>>[],
          };
        }).toList();
      project['files'] = ((_scaffold!['files'] as List?) ?? const [])
        .asMap().entries.where((e) => _picks['files-${e.key}'] != false)
        .map((e) {
          final f = e.value as Map;
          return { 'name': f['name'], 'depth': f['depth'] };
        }).toList();
    }
    await c.mutate('ADD_PROJECT', { 'project': project });
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return _scaffold != null ? _buildPreview() : _buildIdea();
  }

  Widget _buildIdea() {
    return Scaffold(
      backgroundColor: pgPaper,
      appBar: AppBar(
        backgroundColor: pgPaper, elevation: 0,
        iconTheme: const IconThemeData(color: pgInk),
        title: const Text('design mit claude', style: TextStyle(color: pgInk, fontSize: 16)),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(20, 8, 20, MediaQuery.of(context).viewInsets.bottom + 20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const PgEyebrow('projektname'),
            const SizedBox(height: 6),
            TextField(controller: _name, autofocus: true,
              decoration: const InputDecoration(hintText: 'z.B. wave-fx')),
            const SizedBox(height: 14),

            const PgEyebrow('idee · beschreibe was du bauen willst'),
            const SizedBox(height: 6),
            TextField(controller: _desc, maxLines: 8, minLines: 4,
              decoration: const InputDecoration(
                hintText: 'z.B. Website mit login + chat + preise. Stack: nextjs + supabase.')),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _improving ? null : _improve,
              icon: _improving
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(color: pgInk, strokeWidth: 2))
                : const Icon(Icons.auto_awesome, size: 16, color: pgInk),
              label: Text(_improving ? 'claude verbessert…' : '✨ claude verbessert die idee',
                style: const TextStyle(color: pgInk, fontSize: 12)),
              style: OutlinedButton.styleFrom(
                foregroundColor: pgInk,
                side: const BorderSide(color: pgInk, width: 1.5),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              ),
            ),
            const SizedBox(height: 14),

            const PgEyebrow('tech-stack'),
            const SizedBox(height: 6),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final t in _techOptions)
                InkWell(onTap: () => setState(() => _tech = t),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: _tech == t ? pgInk : pgPaper,
                      border: Border.all(color: pgInk, width: 1.5),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(t, style: TextStyle(
                      color: _tech == t ? pgPaper : pgInk,
                      fontFamily: 'monospace', fontSize: 11)),
                  )),
            ]),
            const SizedBox(height: 14),

            const PgEyebrow('lokaler pfad · optional · am PC'),
            const SizedBox(height: 6),
            TextField(controller: _path,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              decoration: const InputDecoration(hintText: 'C:/Users/.../mein-projekt')),
            const SizedBox(height: 16),

            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  border: Border.all(color: pgDanger, width: 1.5),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(_error!, style: const TextStyle(color: pgDanger, fontSize: 13)),
              ),
              const SizedBox(height: 12),
            ],

            Row(children: [
              Expanded(child: OutlinedButton(
                onPressed: (_scaffolding) ? null : () => _create(useScaffold: false),
                child: const Text('leer anlegen'),
              )),
              const SizedBox(width: 8),
              Expanded(flex: 2, child: ElevatedButton(
                onPressed: (_scaffolding || _name.text.trim().isEmpty || _desc.text.trim().isEmpty) ? null : _doScaffold,
                child: _scaffolding
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: pgPaper, strokeWidth: 2))
                  : const Text('mit claude designen →'),
              )),
            ]),
          ]),
        ),
      ),
    );
  }

  Widget _buildPreview() {
    final cats = [
      _Cat('ziele', 'goals', (g) => g.toString()),
      _Cat('regeln', 'rules', (r) => '[${r['category']}] ${r['text']}'),
      _Cat('tasks', 'tasks', (t) {
        final prio = '★' * ((t['priority'] is num ? (t['priority'] as num).toInt() : 3));
        return '$prio ${t['title']} (${t['meta'] ?? ''})';
      }),
      _Cat('dateien', 'files', (f) => '${"  " * ((f['depth'] is num ? (f['depth'] as num).toInt() : 0))}${f['name']}'),
    ];
    return Scaffold(
      backgroundColor: pgPaper,
      appBar: AppBar(
        backgroundColor: pgPaper, elevation: 0,
        iconTheme: const IconThemeData(color: pgInk),
        title: Text(_name.text.trim(), style: const TextStyle(color: pgInk, fontSize: 16)),
        actions: [
          TextButton(
            onPressed: () => setState(() => _scaffold = null),
            child: const Text('← zurück', style: TextStyle(color: pgInk, fontSize: 12)),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(
              'claude hat einen plan. haken-weg = wird nicht angelegt. alles editierbar nachher.',
              style: TextStyle(color: pgInkSoft, fontSize: 12, height: 1.5),
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: cats.length,
              itemBuilder: (_, ci) {
                final cat = cats[ci];
                final list = (_scaffold![cat.key] as List?) ?? const [];
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
                  decoration: BoxDecoration(
                    color: pgPaper,
                    border: Border.all(color: pgInk, width: 1.5),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      PgEyebrow(cat.label),
                      const SizedBox(width: 6),
                      Text('· ${list.length}',
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
                    ]),
                    const SizedBox(height: 4),
                    for (int i = 0; i < list.length; i++)
                      InkWell(
                        onTap: () => setState(() {
                          final k = '${cat.key}-$i';
                          _picks[k] = !(_picks[k] ?? true);
                        }),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Icon(
                              (_picks['${cat.key}-$i'] ?? true) ? Icons.check_box : Icons.check_box_outline_blank,
                              size: 18, color: pgInk),
                            const SizedBox(width: 8),
                            Expanded(child: Text(cat.fmt(list[i]),
                              style: TextStyle(
                                fontSize: 12.5, height: 1.4,
                                fontFamily: cat.key == 'files' ? 'monospace' : null,
                                color: (_picks['${cat.key}-$i'] ?? true) ? pgInk : pgInkFaint,
                              ))),
                          ]),
                        ),
                      ),
                    if (list.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 4),
                        child: Text('—', style: TextStyle(fontSize: 11, color: pgInkFaint)),
                      ),
                  ]),
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              decoration: const BoxDecoration(
                color: pgPaper,
                border: Border(top: BorderSide(color: pgInk, width: 2)),
              ),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => _create(useScaffold: true),
                  child: const Text('projekt anlegen →'),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Cat {
  final String label;
  final String key;
  final String Function(dynamic item) fmt;
  const _Cat(this.label, this.key, this.fmt);
}
