// ProjectDetailsScreen · seltener-gebrauchte projekt-felder.
// Beschreibung · projektziele · dateistruktur · tech · pfad.
// Aufruf via "projekt-details" row im project_screen.

import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';

const _techOptions = [
  'flutter', 'react', 'next.js', 'node', 'python', 'rust', 'go', 'swift', 'android', 'ios', 'anderes',
];

class ProjectDetailsScreen extends StatefulWidget {
  const ProjectDetailsScreen({super.key});
  @override
  State<ProjectDetailsScreen> createState() => _ProjectDetailsScreenState();
}

class _ProjectDetailsScreenState extends State<ProjectDetailsScreen> {
  final _descCtrl = TextEditingController();
  final _pathCtrl = TextEditingController();
  final _goalCtrl = TextEditingController();
  final _fileCtrl = TextEditingController();
  int _fileDepth = 0;
  bool _initialized = false;

  void _ensureInit(Map<String, dynamic> p) {
    if (_initialized) return;
    _descCtrl.text = (p['description'] as String?) ?? '';
    _pathCtrl.text = (p['path'] as String?) ?? '';
    _initialized = true;
  }

  @override
  void dispose() {
    _descCtrl.dispose();
    _pathCtrl.dispose();
    _goalCtrl.dispose();
    _fileCtrl.dispose();
    super.dispose();
  }

  void _patch(SyncClient c, String projectId, Map<String, dynamic> patch) {
    c.mutate('PATCH_PROJECT', {'projectId': projectId, 'patch': patch});
  }

  void _setGoals(SyncClient c, String projectId, List<dynamic> goals) {
    c.mutate('SET_GOALS', {'projectId': projectId, 'goals': goals});
  }

  void _setFiles(SyncClient c, String projectId, List<dynamic> files) {
    c.mutate('SET_FILES', {'projectId': projectId, 'files': files});
  }

  String _uid() => DateTime.now().microsecondsSinceEpoch.toRadixString(36) +
    (1000 + (DateTime.now().millisecond * 7) % 9000).toString();

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    if (p == null) return const Scaffold(body: Center(child: Text('kein projekt')));
    _ensureInit(p);

    final projectId = p['id'] as String;
    final goals = ((p['goals'] as List?) ?? const []).toList();
    final files = ((p['files'] as List?) ?? const []).cast<dynamic>().toList();
    final tech = (p['tech'] as String?) ?? 'anderes';

    return Scaffold(
      backgroundColor: pgPaper,
      appBar: AppBar(
        backgroundColor: pgPaper,
        elevation: 0,
        scrolledUnderElevation: 0,
        foregroundColor: pgInk,
        shape: const Border(bottom: BorderSide(color: pgInk, width: 2)),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const PgEyebrow('projekt-details'),
            const SizedBox(height: 2),
            Text(
              (p['name'] ?? '—').toString(),
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, height: 1.1),
            ),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 32),
        children: [
          // BESCHREIBUNG
          const PgEyebrow('beschreibung'),
          const SizedBox(height: 6),
          _Field(
            controller: _descCtrl,
            hint: 'kurzbeschreibung des projekts — was, für wen, warum',
            maxLines: 4,
            onCommit: (v) {
              if (v != ((p['description'] as String?) ?? '')) {
                _patch(client, projectId, {'description': v});
              }
            },
          ),

          const SizedBox(height: 22),

          // TECH-STACK
          const PgEyebrow('tech-stack'),
          const SizedBox(height: 6),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: pgInkFaint, width: 1.5),
              borderRadius: BorderRadius.circular(8),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: _techOptions.contains(tech) ? tech : 'anderes',
                items: _techOptions.map((t) => DropdownMenuItem(value: t, child: Text(t))).toList(),
                onChanged: (v) {
                  if (v != null) _patch(client, projectId, {'tech': v});
                },
              ),
            ),
          ),

          const SizedBox(height: 22),

          // LOKALER PFAD
          const PgEyebrow('lokaler pfad · für cc-spawn'),
          const SizedBox(height: 6),
          _Field(
            controller: _pathCtrl,
            hint: '/home/dev/projects/wave-fx',
            mono: true,
            onCommit: (v) {
              final t = v.trim();
              if (t != ((p['path'] as String?) ?? '')) {
                _patch(client, projectId, {'path': t});
              }
            },
          ),

          const SizedBox(height: 22),

          // PROJEKTZIELE
          Row(
            children: [
              const Expanded(child: PgEyebrow('projektziele · cc nutzt sie als kontext')),
              Text('${goals.length} stk',
                style: const TextStyle(fontSize: 11, color: pgInkFaint, fontFamily: 'monospace')),
            ],
          ),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  border: Border.all(color: pgInkFaint, width: 1.5),
                  borderRadius: BorderRadius.circular(8),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: TextField(
                  controller: _goalCtrl,
                  decoration: const InputDecoration(
                    hintText: 'was soll erreicht werden?',
                    border: InputBorder.none,
                    isDense: true,
                  ),
                  onSubmitted: (_) {
                    final v = _goalCtrl.text.trim();
                    if (v.isEmpty) return;
                    _setGoals(client, projectId, [...goals, v]);
                    _goalCtrl.clear();
                  },
                ),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: () {
                final v = _goalCtrl.text.trim();
                if (v.isEmpty) return;
                _setGoals(client, projectId, [...goals, v]);
                _goalCtrl.clear();
              },
              style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
              child: const Text('+ ziel'),
            ),
          ]),
          const SizedBox(height: 8),
          if (goals.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Text('noch keine ziele formuliert.',
                style: TextStyle(color: pgInkFaint, fontSize: 12, fontStyle: FontStyle.italic)),
            )
          else
            for (int i = 0; i < goals.length; i++)
              _GoalRow(
                // Key macht state-renaming bei remove robust: ohne den key übernimmt
                // die nachrückende zeile den TextField-state der entfernten zeile.
                key: ValueKey('goal-$i-${goals[i].toString().hashCode}'),
                text: goals[i].toString(),
                onChanged: (v) {
                  final next = [...goals];
                  next[i] = v;
                  _setGoals(client, projectId, next);
                },
                onRemove: () {
                  final next = [...goals]..removeAt(i);
                  _setGoals(client, projectId, next);
                },
              ),

          const SizedBox(height: 22),

          // DATEISTRUKTUR
          Row(
            children: [
              const Expanded(child: PgEyebrow('dateistruktur · ordner mit "/" am ende')),
              Text('${files.length} stk',
                style: const TextStyle(fontSize: 11, color: pgInkFaint, fontFamily: 'monospace')),
            ],
          ),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  border: Border.all(color: pgInkFaint, width: 1.5),
                  borderRadius: BorderRadius.circular(8),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: TextField(
                  controller: _fileCtrl,
                  decoration: const InputDecoration(
                    hintText: 'lib/services/ oder pubspec.yaml',
                    border: InputBorder.none,
                    isDense: true,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              decoration: BoxDecoration(
                border: Border.all(color: pgInkFaint, width: 1.5),
                borderRadius: BorderRadius.circular(8),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<int>(
                  value: _fileDepth,
                  items: [0, 1, 2, 3, 4, 5].map((d) => DropdownMenuItem(value: d, child: Text('↘ $d'))).toList(),
                  onChanged: (v) => setState(() => _fileDepth = v ?? 0),
                ),
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: () {
                final v = _fileCtrl.text.trim();
                if (v.isEmpty) return;
                _setFiles(client, projectId, [...files, {'id': _uid(), 'name': v, 'depth': _fileDepth}]);
                _fileCtrl.clear();
                setState(() => _fileDepth = 0);
              },
              style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12)),
              child: const Text('+'),
            ),
          ]),
          const SizedBox(height: 8),
          if (files.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: Text('noch keine struktur erfasst.',
                style: TextStyle(color: pgInkFaint, fontSize: 12, fontStyle: FontStyle.italic)),
            )
          else
            for (final f in files)
              _FileRow(
                file: f as Map<String, dynamic>,
                onRemove: () {
                  _setFiles(client, projectId, files.where((x) => (x as Map)['id'] != f['id']).toList());
                },
              ),
        ],
      ),
    );
  }
}

class _Field extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final int maxLines;
  final bool mono;
  final void Function(String) onCommit;
  const _Field({
    required this.controller, required this.hint, required this.onCommit,
    this.maxLines = 1, this.mono = false,
  });
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: pgInkFaint, width: 1.5),
        borderRadius: BorderRadius.circular(8),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Focus(
        onFocusChange: (hasFocus) {
          if (!hasFocus) onCommit(controller.text);
        },
        child: TextField(
          controller: controller,
          maxLines: maxLines,
          minLines: 1,
          style: TextStyle(fontFamily: mono ? 'monospace' : null, fontSize: mono ? 12 : 14),
          decoration: InputDecoration(
            hintText: hint,
            border: InputBorder.none,
            isDense: true,
          ),
        ),
      ),
    );
  }
}

// Stateful + Focus-listener: commit nicht nur bei Enter, sondern auch bei tap-away.
class _GoalRow extends StatefulWidget {
  final String text;
  final void Function(String) onChanged;
  final VoidCallback onRemove;
  const _GoalRow({super.key, required this.text, required this.onChanged, required this.onRemove});
  @override
  State<_GoalRow> createState() => _GoalRowState();
}

class _GoalRowState extends State<_GoalRow> {
  late final TextEditingController _ctrl;
  late final FocusNode _focus;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: widget.text);
    _focus = FocusNode();
    _focus.addListener(_commit);
  }

  void _commit() {
    if (_focus.hasFocus) return;
    final v = _ctrl.text.trim();
    if (v.isNotEmpty && v != widget.text) widget.onChanged(v);
  }

  @override
  void dispose() {
    _focus.removeListener(_commit);
    _focus.dispose();
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(
          padding: EdgeInsets.only(top: 12, right: 6),
          child: Text('▸', style: TextStyle(color: pgInkSoft, fontFamily: 'monospace')),
        ),
        Expanded(
          child: TextField(
            controller: _ctrl,
            focusNode: _focus,
            maxLines: null,
            style: const TextStyle(fontSize: 13.5, height: 1.4),
            decoration: const InputDecoration(border: InputBorder.none, isDense: true),
            onSubmitted: (_) => _commit(),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.close, size: 16, color: pgInkFaint),
          splashRadius: 14,
          onPressed: widget.onRemove,
        ),
      ]),
    );
  }
}

class _FileRow extends StatelessWidget {
  final Map<String, dynamic> file;
  final VoidCallback onRemove;
  const _FileRow({required this.file, required this.onRemove});
  @override
  Widget build(BuildContext context) {
    final name = file['name']?.toString() ?? '';
    final depth = (file['depth'] is num ? (file['depth'] as num).toInt() : 0);
    final isDir = name.endsWith('/');
    return Padding(
      padding: EdgeInsets.fromLTRB(depth * 14.0, 2, 0, 2),
      child: Row(children: [
        Text(isDir ? '📁' : '📄', style: const TextStyle(fontSize: 13)),
        const SizedBox(width: 6),
        Expanded(
          child: Text(name,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5),
            overflow: TextOverflow.ellipsis),
        ),
        IconButton(
          icon: const Icon(Icons.close, size: 14, color: pgInkFaint),
          splashRadius: 12,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 26, minHeight: 26),
          onPressed: onRemove,
        ),
      ]),
    );
  }
}
