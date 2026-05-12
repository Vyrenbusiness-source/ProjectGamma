// Ideen-Inbox · primärer Mobile-Use-Case · Quick-Capture matching wireframe.
import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import '../features/idea_to_task/inline_suggest_row.dart';
import '../features/idea_to_task/one_tap_capture.dart';
import '../widgets/swipe_to_complete.dart';

class IdeasScreen extends StatefulWidget {
  const IdeasScreen({super.key});
  @override
  State<IdeasScreen> createState() => _IdeasScreenState();
}

class _IdeasScreenState extends State<IdeasScreen> {
  final _ctrl = TextEditingController();
  bool _sending = false;

  String _relTime(int? ts) {
    if (ts == null) return '—';
    final s = (DateTime.now().millisecondsSinceEpoch - ts) ~/ 1000;
    if (s < 5) return 'jetzt';
    if (s < 60) return '${s}s';
    if (s < 3600) return '${s ~/ 60}m';
    if (s < 86400) return '${s ~/ 3600}h';
    return '${s ~/ 86400}d';
  }

  Future<void> _save() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty) return;
    setState(() => _sending = true);
    final client = SyncClientScope.of(context, listen: false);
    final p = client.activeProject;
    if (p != null) {
      await client.mutate('ADD_IDEA', {
        'projectId': p['id'],
        'idea': {'text': text, 'source': 'mobile', 'status': 'unprocessed'},
      });
      await client.mutate('ADD_SYNC_LOG', {
        'entry': {'source': 'mobile', 'text': 'idee erfasst: „$text"', 'projectId': p['id']},
      });
    }
    _ctrl.clear();
    setState(() => _sending = false);
  }

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    if (p == null) return const Center(child: Text('kein projekt'));

    final ideas = ((p['ideas'] as List?) ?? const []).cast<Map<String, dynamic>>().toList();
    // optimistisches ghost-merge: pending ADD_IDEA aus offline_queue
    for (final q in client.offlineQueue.pending) {
      if (q.type != 'ADD_IDEA' || q.payload['projectId'] != p['id']) continue;
      final ix = (q.payload['idea'] as Map?)?.cast<String, dynamic>() ?? const {};
      ideas.insert(0, {
        ...ix,
        'id': '__ghost_${q.id}',
        '__pending': true,
        'createdAt': q.createdAt.millisecondsSinceEpoch,
        'status': ix['status'] ?? 'unprocessed',
      });
    }
    final unproc = ideas.where((i) => i['status'] == 'unprocessed').toList();
    final inTasks = ideas.where((i) => i['status'] == 'task_created').toList();
    final processed = ideas.where((i) => i['status'] == 'processed').toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        // Quick capture box — kompakt, ohne Overflow
        PgBox(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const PgEyebrow('schnelle notiz'),
              const SizedBox(height: 6),
              TextField(
                controller: _ctrl,
                maxLines: 3,
                minLines: 2,
                decoration: const InputDecoration(
                  hintText: 'was fällt dir gerade ein?',
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                  isDense: true,
                ),
                style: const TextStyle(fontSize: 15, height: 1.4),
              ),
              const Divider(color: pgInkFaint, thickness: 1, height: 14),
              // Footer: Wrap statt Row → kein Overflow auf engem Screen
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                alignment: WrapAlignment.spaceBetween,
                children: [
                  const Text('📱 mobile · jetzt',
                    style: TextStyle(fontFamily: 'monospace', fontSize: 11, color: pgInkFaint)),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      OneTapTaskButton(
                        readText: () => _ctrl.text,
                        onAfter: () { _ctrl.clear(); setState(() {}); },
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: _sending ? null : _save,
                        style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8)),
                        child: _sending
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(color: pgPaper, strokeWidth: 2))
                            : const Text('speichern', style: TextStyle(fontSize: 13)),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        if (unproc.isNotEmpty) ...[
          _Section(label: 'unbearbeitet', count: unproc.length),
          for (final i in unproc)
            if (i['__pending'] == true)
              _IdeaTile(projectId: p['id'], idea: i, relTime: _relTime)
            else
              SwipeToComplete(
                itemKey: '${i['id']}',
                mutationType: 'DISMISS_IDEA',
                payload: {'projectId': p['id'], 'ideaId': i['id']},
                snackLabel: 'idee verworfen',
                icon: Icons.archive_outlined,
                child: _IdeaTile(projectId: p['id'], idea: i, relTime: _relTime),
              ),
          const SizedBox(height: 18),
        ],
        if (inTasks.isNotEmpty) ...[
          _Section(label: '→ in aufgaben', count: inTasks.length),
          for (final i in inTasks) _IdeaTile(projectId: p['id'], idea: i, relTime: _relTime),
          const SizedBox(height: 18),
        ],
        if (processed.isNotEmpty) ...[
          _Section(label: 'verworfen', count: processed.length),
          for (final i in processed) _IdeaTile(projectId: p['id'], idea: i, relTime: _relTime),
          const SizedBox(height: 18),
        ],
        if (ideas.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 40),
            child: Column(
              children: [
                Icon(Icons.lightbulb_outline, size: 48, color: pgInkFaint),
                const SizedBox(height: 8),
                const Text('noch keine ideen.', style: TextStyle(color: pgInkSoft)),
              ],
            ),
          ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  final String label;
  final int count;
  const _Section({required this.label, required this.count});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 6),
      child: Row(children: [
        PgEyebrow(label),
        const SizedBox(width: 6),
        Text('· $count', style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
      ]),
    );
  }
}

class _IdeaTile extends StatelessWidget {
  final String projectId;
  final Map<String, dynamic> idea;
  final String Function(int?) relTime;
  const _IdeaTile({required this.projectId, required this.idea, required this.relTime});

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final status = idea['status']?.toString() ?? 'unprocessed';
    final sourceRaw = idea['source']?.toString() ?? '';
    final isCc = sourceRaw == 'cloud-code';
    final sourceGlyph = sourceRaw == 'mobile' ? '📱' : (isCc ? '🤖' : '💻');
    final pending = idea['__pending'] == true;
    return Opacity(
      opacity: pending ? 0.55 : 1.0,
      child: Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (isCc) ...[
            // cc-badge: kleines sketchy chip, damit sichtbar ist „das hat
            // claude vorgeschlagen, nicht ich".
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: pgPaper,
                  border: Border.all(color: pgInk, width: 1.5),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Text('🤖 cloud-code vorschlag',
                    style: TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 10,
                        color: pgInkSoft,
                        fontWeight: FontWeight.w600)),
              ),
            ),
          ],
          Text(idea['text']?.toString() ?? '', style: const TextStyle(fontSize: 14.5, height: 1.4)),
          const SizedBox(height: 6),
          Text('$sourceGlyph ${relTime(idea['createdAt'] as int?)} · ${{
            'unprocessed': 'noch nicht verarbeitet',
            'task_created': '✓ aufgabe erstellt',
            'processed': '✓ verworfen',
          }[status] ?? status}',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 10.5, color: pgInkSoft),
          ),
          const SizedBox(height: 8),
          if (pending)
            const Padding(
              padding: EdgeInsets.only(top: 4),
              child: Text('• synchronisiert sobald online',
                style: TextStyle(fontSize: 10.5, color: pgInkFaint, fontStyle: FontStyle.italic)),
            ),
          if (!pending && status == 'unprocessed')
            InlineSuggestRow(
              projectId: projectId,
              ideaId: idea['id']?.toString() ?? '',
              ideaText: idea['text']?.toString() ?? '',
            ),
          if (!pending) Wrap(
            spacing: 6, runSpacing: 6,
            children: [
              if (status == 'unprocessed') ...[
                _ActionChip(
                  label: '→ aufgabe',
                  onTap: () => client.mutate('CONVERT_IDEA',
                      {'projectId': projectId, 'ideaId': idea['id']}),
                ),
                _ActionChip(
                  label: 'verwerfen',
                  onTap: () => client.mutate('DISMISS_IDEA', {'projectId': projectId, 'ideaId': idea['id']}),
                ),
              ],
              if (status == 'processed')
                _ActionChip(
                  label: '↺ reaktivieren',
                  onTap: () => client.mutate('REACTIVATE_IDEA', {'projectId': projectId, 'ideaId': idea['id']}),
                ),
              _ActionChip(
                label: '×', danger: true,
                onTap: () => client.mutate('REMOVE_IDEA', {'projectId': projectId, 'ideaId': idea['id']}),
              ),
            ],
          ),
        ],
      ),
      ),
    );
  }
}

class _ActionChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final bool primary;
  final bool danger;
  const _ActionChip({required this.label, required this.onTap, this.primary = false, this.danger = false});
  @override
  Widget build(BuildContext context) {
    final fg = primary ? pgPaper : (danger ? pgDanger : pgInk);
    final bg = primary ? pgInk : pgPaper;
    final border = danger ? pgDanger : pgInk;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
        decoration: BoxDecoration(
          color: bg,
          border: Border.all(color: border, width: 1.5),
          borderRadius: BorderRadius.circular(11),
        ),
        child: Text(label, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w500)),
      ),
    );
  }
}
