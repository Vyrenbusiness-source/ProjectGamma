// Projekt-Home · clean Dashboard für Mobile.
// Zeigt nur das Wichtigste: Stats, Quick-Idea-Capture, neueste Aufgabe.
// Listen + Details liegen in den dedizierten Tabs (aufgaben/regeln/ideen/cloud).

import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import '../features/members/members_screen.dart';

class ProjectScreen extends StatefulWidget {
  const ProjectScreen({super.key});
  @override
  State<ProjectScreen> createState() => _ProjectScreenState();
}

class _ProjectScreenState extends State<ProjectScreen> {
  final _ideaCtrl = TextEditingController();
  bool _saving = false;

  Future<void> _quickSaveIdea() async {
    final text = _ideaCtrl.text.trim();
    if (text.isEmpty) return;
    setState(() => _saving = true);
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    if (p != null) {
      await c.mutate('ADD_IDEA', {'projectId': p['id'], 'idea': {
        'text': text, 'status': 'unprocessed', 'source': 'mobile',
        'createdAt': DateTime.now().millisecondsSinceEpoch,
      }});
      _ideaCtrl.clear();
    }
    if (mounted) setState(() => _saving = false);
  }

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    if (p == null) return const Center(child: Text('kein projekt'));

    final tasks = ((p['tasks'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final ideas = ((p['ideas'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final rules = ((p['rules'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final goals = ((p['goals'] as List?) ?? const []).cast<dynamic>();
    final activity = ((p['activity'] as List?) ?? const []).cast<Map<String, dynamic>>();

    final open = tasks.where((t) => t['done'] != true).length;
    final unprocIdeas = ideas.where((i) => i['status'] == 'unprocessed').length;
    final activeRules = rules.where((r) => r['active'] == true).length;
    final ccRunning = client.state?['ccRunning'] == true;

    final inProgress = tasks.where((t) => t['done'] != true && t['group'] == 'in_progress').toList()
      ..sort((a, b) => ((b['priority'] is num ? (b['priority'] as num).toInt() : 3)).compareTo((a['priority'] is num ? (a['priority'] as num).toInt() : 3)));
    final nextTask = inProgress.isNotEmpty ? inProgress.first : null;

    final messages = ((p['messages'] as List?) ?? const []).length;
    final isFresh = open == 0 && unprocIdeas == 0 && messages == 0;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        // Onboarding-banner für frische projekte
        if (isFresh)
          Container(
            margin: const EdgeInsets.only(bottom: 14),
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
            decoration: BoxDecoration(
              color: pgPaper,
              border: Border.all(color: pgInk, width: 2, style: BorderStyle.solid),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const PgEyebrow('los geht\'s · 3 schritte'),
              const SizedBox(height: 8),
              _OnboardStep(n: '1', title: 'idee erfassen',
                body: 'unten in „schnelle idee" tippen + speichern. ideen werden vom team gesehen.'),
              _OnboardStep(n: '2', title: 'team einladen',
                body: 'oben „mitglieder verwalten" → email eintippen. ihr seht dann beide dieselben aufgaben + chat.'),
              _OnboardStep(n: '3', title: 'mit team chatten',
                body: 'im team-tab unten könnt ihr nachrichten + notizen + termine teilen.'),
            ]),
          ),
        // QUICK STATS — vier Kacheln auf einer Zeile
        Row(children: [
          Expanded(child: _Stat('aufgaben', open, accent: open > 0)),
          const SizedBox(width: 8),
          Expanded(child: _Stat('regeln', activeRules)),
          const SizedBox(width: 8),
          Expanded(child: _Stat('ideen', unprocIdeas, accent: unprocIdeas > 0)),
          const SizedBox(width: 8),
          Expanded(child: _CcStat(running: ccRunning)),
        ]),

        const SizedBox(height: 18),

        // MITGLIEDER · navigations-row (multi-user schicht 2)
        InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => MembersScreen(projectId: p['id'] as String)),
          ),
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
            decoration: BoxDecoration(
              border: Border.all(color: pgInkFaint, width: 1.5),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(children: const [
              Icon(Icons.group_outlined, size: 18, color: pgInk),
              SizedBox(width: 10),
              Expanded(child: Text('mitglieder verwalten',
                style: TextStyle(fontSize: 13.5, color: pgInk))),
              Icon(Icons.chevron_right, size: 18, color: pgInkFaint),
            ]),
          ),
        ),
        const SizedBox(height: 14),

        // QUICK IDEA — sehr prominent, der Mobile-Hauptzweck
        Container(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
          decoration: BoxDecoration(
            border: Border.all(color: pgInk, width: 2),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const PgEyebrow('schnelle idee'),
              const SizedBox(height: 4),
              TextField(
                controller: _ideaCtrl,
                maxLines: 2,
                minLines: 1,
                decoration: const InputDecoration(
                  hintText: 'was fällt dir gerade ein?',
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(vertical: 4),
                ),
                onSubmitted: (_) => _quickSaveIdea(),
                textInputAction: TextInputAction.done,
              ),
              const SizedBox(height: 4),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _saving ? null : _quickSaveIdea,
                  icon: const Icon(Icons.add, size: 16),
                  label: Text(_saving ? 'speichert…' : 'speichern'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
            ],
          ),
        ),

        const SizedBox(height: 18),

        // NÄCHSTE AUFGABE
        if (nextTask != null) ...[
          const PgEyebrow('nächste aufgabe'),
          const SizedBox(height: 6),
          _NextTaskCard(task: nextTask),
          const SizedBox(height: 18),
        ],

        // BESCHREIBUNG (wenn vorhanden, kompakt)
        if ((p['description'] as String?)?.isNotEmpty ?? false) ...[
          const PgEyebrow('beschreibung'),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: Text(p['description'] as String,
              style: const TextStyle(color: pgInkSoft, fontSize: 13, height: 1.5)),
          ),
          const SizedBox(height: 18),
        ],

        // PROJEKTZIELE — kompakte Bullet-Liste
        if (goals.isNotEmpty) ...[
          const PgEyebrow('projektziele'),
          const SizedBox(height: 4),
          for (final g in goals) Padding(
            padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('▸ ', style: TextStyle(color: pgInkSoft, fontFamily: 'monospace')),
                Expanded(child: Text(g.toString(),
                  style: const TextStyle(fontSize: 13, height: 1.45))),
              ],
            ),
          ),
          const SizedBox(height: 18),
        ],

        // LETZTE AKTIVITÄT (top 3)
        if (activity.isNotEmpty) ...[
          const PgEyebrow('letzte aktivität'),
          const SizedBox(height: 4),
          for (final e in activity.take(3)) Padding(
            padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 16, child: Text(_glyph(e['type']?.toString()),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: pgInkSoft))),
                const SizedBox(width: 4),
                Expanded(child: Text(_stripHtml(e['text']?.toString() ?? ''),
                  style: const TextStyle(fontSize: 12, height: 1.4),
                  maxLines: 2, overflow: TextOverflow.ellipsis)),
                const SizedBox(width: 4),
                Text(_relTime(e['ts'] as int?),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 9.5, color: pgInkFaint)),
              ],
            ),
          ),
        ],
      ],
    );
  }

  static String _glyph(String? t) => switch (t) {
    'write' => '●', 'check' => '✓', 'read' => '►', 'warn' => '!',
    'edit' => '✎', 'sync' => '↻', 'rule' => '⚖', 'info' => 'ⓘ', _ => '·',
  };
  static String _relTime(int? ts) {
    if (ts == null) return '—';
    final s = (DateTime.now().millisecondsSinceEpoch - ts) ~/ 1000;
    if (s < 5) return 'jetzt';
    if (s < 60) return '${s}s';
    if (s < 3600) return '${s ~/ 60}m';
    if (s < 86400) return '${s ~/ 3600}h';
    return '${s ~/ 86400}d';
  }
  static String _stripHtml(String s) =>
    s.replaceAll(RegExp(r'<[^>]+>'), '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

class _Stat extends StatelessWidget {
  final String label;
  final int value;
  final bool accent;
  const _Stat(this.label, this.value, {this.accent = false});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
      decoration: BoxDecoration(
        color: accent ? pgInk : pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(children: [
        Text('$value', style: TextStyle(
          fontFamily: 'monospace', fontSize: 20, fontWeight: FontWeight.w700,
          color: accent ? pgPaper : pgInk,
        )),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(
          fontSize: 9.5, color: accent ? pgPaper : pgInkSoft, fontFamily: 'monospace',
        )),
      ]),
    );
  }
}

class _CcStat extends StatelessWidget {
  final bool running;
  const _CcStat({required this.running});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(children: [
        Icon(Icons.bolt, size: 20, color: running ? pgInk : pgInkFaint),
        const SizedBox(height: 2),
        Text(running ? 'aktiv' : 'pause',
          style: const TextStyle(fontSize: 9.5, color: pgInkSoft, fontFamily: 'monospace')),
      ]),
    );
  }
}

class _OnboardStep extends StatelessWidget {
  final String n;
  final String title;
  final String body;
  const _OnboardStep({required this.n, required this.title, required this.body});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 22, height: 22, alignment: Alignment.center,
          decoration: const BoxDecoration(color: pgInk, shape: BoxShape.circle),
          child: Text(n, style: const TextStyle(
            color: pgPaper, fontFamily: 'monospace', fontSize: 11, fontWeight: FontWeight.w700)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(body, style: const TextStyle(fontSize: 12, color: pgInkSoft, height: 1.4)),
          ]),
        ),
      ]),
    );
  }
}

class _NextTaskCard extends StatelessWidget {
  final Map<String, dynamic> task;
  const _NextTaskCard({required this.task});
  @override
  Widget build(BuildContext context) {
    final prio = task['priority'] is num ? (task['priority'] as num).toInt() : 3;
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(color: pgInk, offset: const Offset(3, 3), blurRadius: 0),
        ],
      ),
      child: Row(children: [
        // Prio-Stripe links
        Container(
          width: 4, height: 32,
          decoration: BoxDecoration(
            color: prio >= 5 ? pgDanger : prio >= 4 ? const Color(0xFFCC8800) : pgInkSoft,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(
          task['title']?.toString() ?? '',
          style: const TextStyle(fontSize: 14, height: 1.35),
          maxLines: 2, overflow: TextOverflow.ellipsis,
        )),
        if ((task['meta']?.toString() ?? '').isNotEmpty)
          PgChip(task['meta'].toString()),
      ]),
    );
  }
}
