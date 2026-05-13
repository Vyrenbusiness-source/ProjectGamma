// Aufgaben: Liste mit Toggle, Sub-Tasks, Add via FAB.
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../theme.dart';
import '../sync_client.dart';
import '../widgets/swipe_to_complete.dart';

class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key});
  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  final _search = TextEditingController();
  bool _showDone = true;

  @override
  void dispose() { _search.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    if (p == null) return const Center(child: Text('kein projekt'));
    final tasks = ((p['tasks'] as List?) ?? const []).cast<Map<String, dynamic>>().toList();
    for (final q in client.offlineQueue.pending) {
      if (q.type != 'ADD_TASK') continue;
      if (q.payload['projectId'] != p['id']) continue;
      final tk = (q.payload['task'] as Map?)?.cast<String, dynamic>() ?? const {};
      tasks.add({...tk, 'id': '__ghost_${q.id}', '__pending': true});
    }

    // Suche + filter
    final qStr = _search.text.trim().toLowerCase();
    final filtered = tasks.where((t) {
      if (!_showDone && t['done'] == true) return false;
      if (qStr.isEmpty) return true;
      final title = (t['title'] ?? '').toString().toLowerCase();
      final meta = (t['meta'] ?? '').toString().toLowerCase();
      return title.contains(qStr) || meta.contains(qStr);
    }).toList();

    final groups = [
      {'id': 'in_progress', 'label': 'in arbeit'},
      {'id': 'next',        'label': 'als nächstes'},
      {'id': 'done',        'label': 'erledigt'},
    ];
    final totalShown = filtered.length;
    final isEmpty = totalShown == 0;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Column(children: [
        // Search-bar + filter-chip
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(children: [
            Expanded(child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                isDense: true,
                hintText: 'tasks suchen…',
                prefixIcon: const Icon(Icons.search, size: 18, color: pgInkSoft),
                suffixIcon: _search.text.isEmpty ? null : IconButton(
                  icon: const Icon(Icons.close, size: 16, color: pgInkSoft),
                  onPressed: () => setState(() => _search.clear()),
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 10),
              ),
            )),
            const SizedBox(width: 6),
            InkWell(
              onTap: () => setState(() => _showDone = !_showDone),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: _showDone ? pgPaper : pgInk,
                  border: Border.all(color: pgInk, width: 1.5),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Text(_showDone ? 'mit done' : 'ohne done',
                  style: TextStyle(color: _showDone ? pgInk : pgPaper,
                    fontFamily: 'monospace', fontSize: 11)),
              ),
            ),
          ]),
        ),
        Expanded(
          child: isEmpty
            ? Center(child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(qStr.isNotEmpty ? Icons.search_off : Icons.task_alt,
                    size: 56, color: pgInkFaint),
                  const SizedBox(height: 12),
                  Text(qStr.isNotEmpty
                      ? 'keine treffer für „$qStr"'
                      : (tasks.isEmpty ? 'noch keine aufgaben' : 'alles erledigt 🎉'),
                    style: const TextStyle(color: pgInkSoft, fontSize: 14), textAlign: TextAlign.center),
                  if (qStr.isEmpty && tasks.isEmpty) ...[
                    const SizedBox(height: 8),
                    const Text('tippe auf + um deine erste aufgabe anzulegen.',
                      style: TextStyle(color: pgInkFaint, fontSize: 12, height: 1.5),
                      textAlign: TextAlign.center),
                  ],
                ])))
            : ListView(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
              children: [
                for (final g in groups) ...[
                  if (filtered.where((t) => t['group'] == g['id']).isNotEmpty) ...[
                    _GroupHeader(
                      label: g['label']!,
                      count: filtered.where((t) => t['group'] == g['id']).length),
                    const SizedBox(height: 8),
                    for (final t in (filtered.where((t) => t['group'] == g['id']).toList()
                                      ..sort((a, b) => ((b['priority'] is num ? (b['priority'] as num).toInt() : 3)).compareTo((a['priority'] is num ? (a['priority'] as num).toInt() : 3)))))
                      if (t['__pending'] == true)
                        _TaskTile(projectId: p['id'], task: t)
                      else
                        SwipeToComplete(
                          itemKey: '${t['id']}',
                          mutationType: 'TOGGLE_TASK',
                          payload: {'projectId': p['id'], 'taskId': t['id']},
                          snackLabel: t['done'] == true ? 'als offen markiert' : 'aufgabe erledigt',
                          icon: t['done'] == true ? Icons.undo : Icons.check,
                          child: _TaskTile(projectId: p['id'], task: t),
                        ),
                    const SizedBox(height: 18),
                  ],
                ],
              ],
            ),
        ),
      ]),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _addTaskDialog(context, p['id']),
        backgroundColor: pgInk,
        foregroundColor: pgPaper,
        elevation: 0,
        shape: const CircleBorder(side: BorderSide(color: pgInk, width: 2)),
        child: const Icon(Icons.add),
      ),
    );
  }

  void _addTaskDialog(BuildContext context, String projectId) {
    final ctrl = TextEditingController();
    String group = 'next';
    showModalBottomSheet(
      context: context,
      backgroundColor: pgPaper,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (sheetCtx) {
        return StatefulBuilder(
          builder: (_, setSheetState) => Padding(
            padding: EdgeInsets.fromLTRB(20, 14, 20, MediaQuery.of(sheetCtx).viewInsets.bottom + 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const PgEyebrow('neue aufgabe'),
                const SizedBox(height: 8),
                TextField(
                  controller: ctrl,
                  autofocus: true,
                  decoration: const InputDecoration(hintText: 'was ist zu tun?'),
                  textInputAction: TextInputAction.done,
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final g in const ['in_progress', 'next', 'done'])
                      _GroupChip(
                        label: g.replaceAll('_', ' '),
                        active: group == g,
                        onTap: () => setSheetState(() => group = g),
                      ),
                  ],
                ),
                const SizedBox(height: 18),
                Row(children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(sheetCtx),
                      child: const Text('abbrechen'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () async {
                        final title = ctrl.text.trim();
                        if (title.isEmpty) return;
                        final client = SyncClientScope.of(sheetCtx, listen: false);
                        await client.mutate('ADD_TASK', {
                          'projectId': projectId,
                          'task': {'title': title, 'done': false, 'group': group, 'meta': '', 'subtasks': []},
                        });
                        await client.mutate('ADD_SYNC_LOG', {
                          'entry': {'source': 'mobile', 'text': 'aufgabe erstellt: <i>$title</i>', 'projectId': projectId},
                        });
                        if (sheetCtx.mounted) Navigator.pop(sheetCtx);
                      },
                      child: const Text('speichern'),
                    ),
                  ),
                ]),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _GroupHeader extends StatelessWidget {
  final String label;
  final int count;
  const _GroupHeader({required this.label, required this.count});
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        PgEyebrow(label),
        const SizedBox(width: 6),
        Text('· $count', style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
      ],
    );
  }
}

class _GroupChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _GroupChip({required this.label, required this.active, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? pgInk : pgPaper,
          border: Border.all(color: pgInk, width: 1.5),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? pgPaper : pgInk,
            fontFamily: 'monospace',
            fontSize: 11,
          ),
        ),
      ),
    );
  }
}

class _TaskTile extends StatelessWidget {
  final String projectId;
  final Map<String, dynamic> task;
  const _TaskTile({required this.projectId, required this.task});

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final done = task['done'] == true;
    final subtasks = ((task['subtasks'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final meta = task['meta']?.toString() ?? '';
    final prio = task['priority'] is num ? (task['priority'] as num).toInt() : 3;
    final pending = task['__pending'] == true;
    return Opacity(
      opacity: pending ? 0.55 : 1.0,
      child: Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(0, 10, 8, 10),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: pending ? 1 : 2, style: pending ? BorderStyle.solid : BorderStyle.solid),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Priority-Stripe links statt Badge — schmal, klar erkennbar
              Container(
                width: 4,
                margin: const EdgeInsets.only(right: 8, top: 2),
                height: 22,
                decoration: BoxDecoration(
                  color: prio >= 5 ? pgDanger : prio >= 4 ? const Color(0xFFCC8800) : prio >= 3 ? pgInk : pgInkFaint,
                  borderRadius: const BorderRadius.only(topRight: Radius.circular(2), bottomRight: Radius.circular(2)),
                ),
              ),
              _Check(
                done: done,
                onTap: () async {
                  await client.mutate('TOGGLE_TASK', {'projectId': projectId, 'taskId': task['id']});
                  if (!done) {
                    await client.mutate('ADD_SYNC_LOG', {
                      'entry': {'source': 'mobile', 'text': 'aufgabe erledigt: <i>${task['title']}</i>', 'projectId': projectId},
                    });
                  }
                },
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  task['title']?.toString() ?? '',
                  style: TextStyle(
                    fontSize: 14.5,
                    height: 1.4,
                    decoration: done ? TextDecoration.lineThrough : null,
                    color: done ? pgInkFaint : pgInk,
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.close, color: pgInkFaint, size: 18),
                onPressed: () async {
                  await client.mutate('REMOVE_TASK', {'projectId': projectId, 'taskId': task['id']});
                },
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
              ),
            ],
          ),
          // Meta in eigene Zeile (prevents vertical-text overflow bei langen Metas)
          if (meta.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(34, 4, 0, 0),
              child: Wrap(spacing: 4, children: [PgChip(meta)]),
            ),
          // Zerlegen-button (Task 6) — nur für offene tasks ohne subtasks.
          // 1× claude-call, ~0.20$ budget cap (server-seitig).
          if (!done && !pending && subtasks.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(34, 6, 0, 0),
              child: InkWell(
                onTap: () async {
                  final c = SyncClientScope.of(context, listen: false);
                  try {
                    final r = await http.post(
                      Uri.parse('${c.serverUrl}/api/cc/decompose'),
                      headers: {...c.authHeader, 'content-type': 'application/json'},
                      body: jsonEncode({'projectId': projectId, 'taskId': task['id']}),
                    ).timeout(const Duration(seconds: 5));
                    if (!context.mounted) return;
                    if (r.statusCode != 200) {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                        content: Text('zerlegen-fehler: ${r.statusCode}'),
                      ));
                    } else {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text('cc zerlegt task… subtasks erscheinen gleich'),
                      ));
                    }
                  } catch (e) {
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                      content: Text('fehler: $e'),
                    ));
                  }
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: pgPaper,
                    border: Border.all(color: pgInk, width: 1.5),
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: const Text('🪓 cc zerlegen',
                      style: TextStyle(fontFamily: 'monospace', fontSize: 10.5, fontWeight: FontWeight.w600)),
                ),
              ),
            ),
          if (subtasks.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 34, top: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final s in subtasks)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Row(
                        children: [
                          _Check(
                            done: s['done'] == true,
                            small: true,
                            onTap: () => client.mutate('TOGGLE_SUBTASK', {
                              'projectId': projectId, 'taskId': task['id'], 'subtaskId': s['id'],
                            }),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              s['title']?.toString() ?? '',
                              style: TextStyle(
                                fontSize: 13,
                                color: s['done'] == true ? pgInkFaint : pgInk,
                                decoration: s['done'] == true ? TextDecoration.lineThrough : null,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          if (pending)
            Padding(
              padding: const EdgeInsets.only(left: 34, top: 4),
              child: Text('• synchronisiert sobald online',
                style: const TextStyle(fontSize: 10.5, color: pgInkFaint, fontStyle: FontStyle.italic)),
            ),
        ],
      ),
      ),
    );
  }
}

class _Check extends StatelessWidget {
  final bool done;
  final VoidCallback onTap;
  final bool small;
  const _Check({required this.done, required this.onTap, this.small = false});
  @override
  Widget build(BuildContext context) {
    final size = small ? 14.0 : 18.0;
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.only(top: 2),
        width: size, height: size,
        decoration: BoxDecoration(
          color: done ? pgInk : pgPaper,
          border: Border.all(color: pgInk, width: 2),
          borderRadius: BorderRadius.circular(3),
        ),
        child: done
            ? Icon(Icons.check, size: small ? 10 : 13, color: pgPaper)
            : null,
      ),
    );
  }
}
