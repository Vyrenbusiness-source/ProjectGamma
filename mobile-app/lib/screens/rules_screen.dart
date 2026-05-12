// Regeln-Screen · vollständige Parität zum Desktop:
// - Liste aller Regeln gruppiert nach Kategorie
// - Toggle aktiv/inaktiv per Tap
// - Add via FAB (Kategorie + Text)
// - Edit per Long-Press (Bottom-Sheet)
// - Delete per ×
// - Empfohlene Regeln (14 Best-Practices) via Quick-Toggle
// - Cloud-Code-Vorschläge (suggestedBy=cloud-code) annehmen / verwerfen

import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import '../features/rule_diffs/rule_diffs_panel.dart';

const _ruleCategories = ['code-stil', 'architektur', 'workflow'];

const _suggestedRules = <Map<String, String>>[
  {'category': 'code-stil',  'text': 'tdd: tests vor implementation'},
  {'category': 'code-stil',  'text': 'kein toten code (unused imports/vars)'},
  {'category': 'code-stil',  'text': 'magic numbers durch konstanten ersetzen'},
  {'category': 'code-stil',  'text': "frühe returns statt verschachtelte if's"},
  {'category': 'code-stil',  'text': 'max. 200 zeilen pro file'},
  {'category': 'architektur', 'text': 'ein modul = eine verantwortlichkeit'},
  {'category': 'architektur', 'text': 'abhängigkeitsrichtung: domain ← infrastructure'},
  {'category': 'architektur', 'text': 'keine zyklen zwischen modulen'},
  {'category': 'architektur', 'text': 'tests in separater struktur (test/, __tests__/)'},
  {'category': 'workflow',    'text': 'kein commit ohne grünes lint + test'},
  {'category': 'workflow',    'text': 'secrets nie in source-tree (env/secret-manager)'},
  {'category': 'workflow',    'text': 'semver einhalten: feat → minor, fix → patch'},
  {'category': 'workflow',    'text': 'PR-titel folgen conventional commits'},
  {'category': 'workflow',    'text': 'kein force-push auf main/master'},
];

class RulesScreen extends StatefulWidget {
  const RulesScreen({super.key});
  @override
  State<RulesScreen> createState() => _RulesScreenState();
}

class _RulesScreenState extends State<RulesScreen> {
  bool _showSuggested = false;

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    if (p == null) return const Center(child: Text('kein projekt'));
    final pid = p['id'] as String;
    final rules = ((p['rules'] as List?) ?? const []).cast<Map<String, dynamic>>();

    final ccSuggestions = rules.where((r) => r['active'] != true && r['suggestedBy'] == 'cloud-code').toList();
    final activeCount = rules.where((r) => r['active'] == true).length;

    final norm = (String s) => s.trim().toLowerCase();
    final existing = rules.map((r) => norm(r['text']?.toString() ?? '')).toSet();
    final availableSuggested = _suggestedRules.where((s) => !existing.contains(norm(s['text']!))).toList();

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
        children: [
          // Header-Stat
          Row(children: [
            PgChip('aktiv $activeCount', solid: true),
            const SizedBox(width: 6),
            PgChip('total ${rules.length}'),
            const Spacer(),
            OutlinedButton.icon(
              onPressed: () => setState(() => _showSuggested = !_showSuggested),
              icon: Icon(_showSuggested ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down, size: 16),
              label: Text('empfohlene (${availableSuggested.length})'),
              style: OutlinedButton.styleFrom(
                foregroundColor: pgInk,
                side: const BorderSide(color: pgInk, width: 1.5),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ]),
          const SizedBox(height: 14),

          // Pending rule-diffs (cc-vorschläge zum aktivieren/deaktivieren)
          RuleDiffsPanel(project: p),

          // CC-Vorschläge (wenn vorhanden)
          if (ccSuggestions.isNotEmpty) ...[
            const PgEyebrow('cloud-code regel-vorschläge'),
            const SizedBox(height: 6),
            PgBox(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              child: Column(
                children: [
                  for (final r in ccSuggestions)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        children: [
                          PgChip(r['category']?.toString() ?? '?'),
                          const SizedBox(width: 8),
                          Expanded(child: Text(r['text']?.toString() ?? '', style: const TextStyle(fontSize: 13))),
                          IconButton(
                            icon: const Icon(Icons.check, color: pgInk, size: 18),
                            tooltip: 'annehmen',
                            onPressed: () => client.mutate('TOGGLE_RULE', {'projectId': pid, 'ruleId': r['id']}),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close, color: pgInkFaint, size: 18),
                            tooltip: 'verwerfen',
                            onPressed: () => client.mutate('REMOVE_RULE', {'projectId': pid, 'ruleId': r['id']}),
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Empfohlene Regeln (collapsable)
          if (_showSuggested && availableSuggested.isNotEmpty) ...[
            const PgEyebrow('empfohlene · klick zum aktivieren'),
            const SizedBox(height: 6),
            PgBox(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              child: Column(
                children: [
                  for (final s in availableSuggested)
                    InkWell(
                      onTap: () async {
                        await client.mutate('ADD_RULE', {
                          'projectId': pid,
                          'rule': {'category': s['category'], 'text': s['text'], 'active': true},
                        });
                        await client.mutate('ADD_SYNC_LOG', {
                          'entry': {'source': 'mobile', 'projectId': pid, 'text': 'empfohlene regel aktiviert: <i>${s['text']}</i>'},
                        });
                      },
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Row(
                          children: [
                            PgChip(s['category']!),
                            const SizedBox(width: 8),
                            Expanded(child: Text(s['text']!, style: const TextStyle(fontSize: 13))),
                            const Icon(Icons.add_circle_outline, size: 18, color: pgInkSoft),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Regeln gruppiert
          for (final cat in _ruleCategories) ...[
            _CategoryHeader(category: cat, count: rules.where((r) => r['category'] == cat).length),
            const SizedBox(height: 6),
            ...rules.where((r) => r['category'] == cat).map((r) => _RuleTile(projectId: pid, rule: r)),
            const SizedBox(height: 16),
          ],
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _addRuleSheet(context, pid),
        backgroundColor: pgInk,
        foregroundColor: pgPaper,
        elevation: 0,
        shape: const CircleBorder(side: BorderSide(color: pgInk, width: 2)),
        child: const Icon(Icons.add),
      ),
    );
  }

  void _addRuleSheet(BuildContext context, String projectId) {
    final ctrl = TextEditingController();
    String category = 'code-stil';
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
                const PgEyebrow('neue regel'),
                const SizedBox(height: 8),
                Wrap(spacing: 8, children: [
                  for (final c in _ruleCategories)
                    InkWell(
                      onTap: () => setSheetState(() => category = c),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: category == c ? pgInk : pgPaper,
                          border: Border.all(color: pgInk, width: 1.5),
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(c, style: TextStyle(
                          color: category == c ? pgPaper : pgInk,
                          fontFamily: 'monospace', fontSize: 11,
                        )),
                      ),
                    ),
                ]),
                const SizedBox(height: 12),
                TextField(
                  controller: ctrl,
                  autofocus: true,
                  decoration: const InputDecoration(hintText: 'z.B. öffentliche api dokumentiert'),
                ),
                const SizedBox(height: 18),
                Row(children: [
                  Expanded(child: OutlinedButton(
                    onPressed: () => Navigator.pop(sheetCtx),
                    child: const Text('abbrechen'),
                  )),
                  const SizedBox(width: 10),
                  Expanded(child: ElevatedButton(
                    onPressed: () async {
                      final text = ctrl.text.trim();
                      if (text.isEmpty) return;
                      final client = SyncClientScope.of(sheetCtx, listen: false);
                      await client.mutate('ADD_RULE', {
                        'projectId': projectId,
                        'rule': {'category': category, 'text': text, 'active': true},
                      });
                      if (sheetCtx.mounted) Navigator.pop(sheetCtx);
                    },
                    child: const Text('hinzufügen'),
                  )),
                ]),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _CategoryHeader extends StatelessWidget {
  final String category;
  final int count;
  const _CategoryHeader({required this.category, required this.count});
  @override
  Widget build(BuildContext context) {
    return Row(children: [
      PgEyebrow(category),
      const SizedBox(width: 6),
      Text('· $count', style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
    ]);
  }
}

class _RuleTile extends StatelessWidget {
  final String projectId;
  final Map<String, dynamic> rule;
  const _RuleTile({required this.projectId, required this.rule});

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final active = rule['active'] == true;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        onTap: () => client.mutate('TOGGLE_RULE', {'projectId': projectId, 'ruleId': rule['id']}),
        onLongPress: () => _editRuleSheet(context, projectId, rule),
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 8, 6, 8),
          decoration: BoxDecoration(
            color: pgPaper,
            border: Border.all(color: active ? pgInk : pgInkFaint, width: active ? 2 : 1.5),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(children: [
            Container(
              width: 16, height: 16,
              margin: const EdgeInsets.only(top: 2),
              decoration: BoxDecoration(
                color: active ? pgInk : pgPaper,
                border: Border.all(color: pgInk, width: 2),
                borderRadius: BorderRadius.circular(3),
              ),
              child: active ? const Icon(Icons.check, size: 11, color: pgPaper) : null,
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(
              rule['text']?.toString() ?? '',
              style: TextStyle(
                fontSize: 13.5,
                color: active ? pgInk : pgInkFaint,
                decoration: active ? null : TextDecoration.lineThrough,
              ),
            )),
            IconButton(
              icon: const Icon(Icons.close, size: 16, color: pgInkFaint),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
              onPressed: () => client.mutate('REMOVE_RULE', {'projectId': projectId, 'ruleId': rule['id']}),
            ),
          ]),
        ),
      ),
    );
  }

  void _editRuleSheet(BuildContext context, String projectId, Map<String, dynamic> rule) {
    final ctrl = TextEditingController(text: rule['text']?.toString() ?? '');
    showModalBottomSheet(
      context: context,
      backgroundColor: pgPaper,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (sheetCtx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 14, 20, MediaQuery.of(sheetCtx).viewInsets.bottom + 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const PgEyebrow('regel bearbeiten'),
            const SizedBox(height: 8),
            TextField(controller: ctrl, autofocus: true),
            const SizedBox(height: 18),
            ElevatedButton(
              onPressed: () async {
                final text = ctrl.text.trim();
                if (text.isEmpty) return;
                final client = SyncClientScope.of(sheetCtx, listen: false);
                await client.mutate('EDIT_RULE', {
                  'projectId': projectId, 'ruleId': rule['id'], 'text': text,
                });
                if (sheetCtx.mounted) Navigator.pop(sheetCtx);
              },
              child: const Text('speichern'),
            ),
          ],
        ),
      ),
    );
  }
}
