// Projekt-Home · clean Dashboard für Mobile.
// Zeigt nur das Wichtigste: Stats, Quick-Idea-Capture, neueste Aufgabe.
// Listen + Details liegen in den dedizierten Tabs (aufgaben/regeln/ideen/cloud).

import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import '../features/members/members_screen.dart';
import 'rules_screen.dart';
import 'team_screen.dart';
import 'project_details_screen.dart';

class ProjectScreen extends StatefulWidget {
  const ProjectScreen({super.key});
  @override
  State<ProjectScreen> createState() => _ProjectScreenState();
}

class _ProjectScreenState extends State<ProjectScreen> {
  final _ideaCtrl = TextEditingController();
  bool _saving = false;
  // D5 · onboarding dismiss-state (manuell)
  bool _onboardDismissed = false;

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

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        // D5 · Onboarding mit auto-collapse + per-step-done-status:
        //   step 1: ≥1 idee erfasst
        //   step 2: ≥1 mitglied außer owner (members > 1)
        //   step 3: ≥1 chat-message in der activity
        _OnboardingBanner(
          project: p,
          dismissed: _onboardDismissed,
          onDismiss: () => setState(() => _onboardDismissed = true),
          onExpand: () => setState(() => _onboardDismissed = false),
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

        // NAV-ROWS · regeln + mitglieder + team-chat wandern hier rein,
        // damit die bottom-nav auf 4 statt 6 tabs schrumpfen kann (M3).
        // Hint zeigt direkt den state-counter (z.B. "19/19 aktiv").
        _NavRow(
          icon: Icons.gavel,
          label: 'regeln',
          hint: rules.isEmpty ? 'noch keine regeln' : '$activeRules aktiv · ${rules.length} gesamt',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const RulesScreen()),
          ),
        ),
        const SizedBox(height: 8),
        _NavRow(
          icon: Icons.group_outlined,
          label: 'mitglieder verwalten',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => MembersScreen(projectId: p['id'] as String)),
          ),
        ),
        const SizedBox(height: 8),
        _NavRow(
          icon: Icons.chat_bubble_outline,
          label: 'team-chat & notizen',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const TeamScreen()),
          ),
        ),
        const SizedBox(height: 8),
        // PROJEKT-DETAILS · beschreibung · ziele · dateien · pfad
        _NavRow(
          icon: Icons.edit_note_outlined,
          label: 'projekt-details',
          hint: goals.isEmpty ? 'beschreibung · ziele · dateien' : '${goals.length} ziele · pfad · dateien',
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const ProjectDetailsScreen()),
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

        // ZIELE-preview · 1-zeilig · tap = projekt-details
        if (goals.isNotEmpty) ...[
          InkWell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ProjectDetailsScreen()),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
              child: Row(children: [
                const Text('ziele: ',
                  style: TextStyle(fontSize: 11.5, color: pgInkFaint, fontFamily: 'monospace')),
                Expanded(
                  child: Text(
                    goals.take(3).join('  ·  ') + (goals.length > 3 ? '  +${goals.length - 3}' : ''),
                    style: const TextStyle(fontSize: 12.5, color: pgInkSoft, height: 1.4),
                    maxLines: 2, overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 6),
                const Icon(Icons.edit, size: 13, color: pgInkFaint),
              ]),
            ),
          ),
          const SizedBox(height: 14),
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
    // Konsistent zu _Stat: gleiches layout (großer wert + kleines label).
    // Hier ist der „wert" das status-symbol/wort.
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 6),
      decoration: BoxDecoration(
        color: running ? pgInk : pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(children: [
        Text(
          running ? 'AN' : 'AUS',
          style: TextStyle(
            fontFamily: 'monospace', fontSize: 20, fontWeight: FontWeight.w700,
            color: running ? pgPaper : pgInkSoft,
          ),
        ),
        const SizedBox(height: 2),
        Text('cloud-code',
          style: TextStyle(
            fontSize: 9.5,
            color: running ? pgPaper : pgInkSoft,
            fontFamily: 'monospace',
          )),
      ]),
    );
  }
}

class _OnboardStep extends StatelessWidget {
  final String n;
  final String title;
  final String body;
  final bool done;
  const _OnboardStep({required this.n, required this.title, required this.body, this.done = false});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 22, height: 22, alignment: Alignment.center,
          decoration: BoxDecoration(
            color: done ? const Color(0xFF2A8A3A) : pgInk,
            shape: BoxShape.circle),
          child: Text(done ? '✓' : n, style: const TextStyle(
            color: pgPaper, fontFamily: 'monospace', fontSize: 11, fontWeight: FontWeight.w700)),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: TextStyle(
              fontSize: 13.5, fontWeight: FontWeight.w700,
              decoration: done ? TextDecoration.lineThrough : null,
              color: done ? pgInkSoft : pgInk)),
            const SizedBox(height: 2),
            Text(body, style: const TextStyle(fontSize: 12, color: pgInkSoft, height: 1.4)),
          ]),
        ),
      ]),
    );
  }
}

// D5 · Onboarding-banner mit auto-collapse-logik.
class _OnboardingBanner extends StatelessWidget {
  final Map<String, dynamic> project;
  final bool dismissed;
  final VoidCallback onDismiss;
  final VoidCallback onExpand;
  const _OnboardingBanner({
    required this.project, required this.dismissed,
    required this.onDismiss, required this.onExpand,
  });
  @override
  Widget build(BuildContext context) {
    final ideas = ((project['ideas'] as List?) ?? const []).length;
    final members = ((project['members'] as List?) ?? const []).length;
    final activity = ((project['activity'] as List?) ?? const []).cast<Map<String, dynamic>>();
    final hasIdea = ideas > 0;
    final hasTeam = members > 1;
    final hasChat = activity.any((a) => a['type'] == 'chat' || a['type'] == 'msg');
    final allDone = hasIdea && hasTeam && hasChat;
    final progress = [hasIdea, hasTeam, hasChat].where((b) => b).length;
    final collapsed = allDone || dismissed;

    if (collapsed) {
      return Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
        decoration: BoxDecoration(
          color: pgPaper,
          border: Border.all(color: pgInkFaint, width: 1.5),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(children: [
          Text(allDone ? '✓' : '·', style: const TextStyle(fontSize: 14, color: pgInkSoft)),
          const SizedBox(width: 8),
          Expanded(child: Text(
            allDone ? 'onboarding abgeschlossen' : 'onboarding minimiert',
            style: const TextStyle(fontSize: 12, color: pgInkSoft),
          )),
          TextButton(
            onPressed: onExpand,
            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 10)),
            child: const Text('einblenden', style: TextStyle(fontSize: 11, color: pgInk)),
          ),
        ]),
      );
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: PgEyebrow('los geht\'s · $progress/3 schritte')),
          GestureDetector(
            onTap: onDismiss,
            child: const Padding(
              padding: EdgeInsets.all(4),
              child: Icon(Icons.close, size: 16, color: pgInkFaint),
            ),
          ),
        ]),
        const SizedBox(height: 8),
        _OnboardStep(n: '1', title: 'idee erfassen',
          body: 'unten in „schnelle idee" tippen + speichern. ideen werden vom team gesehen.',
          done: hasIdea),
        _OnboardStep(n: '2', title: 'team einladen',
          body: 'oben „mitglieder verwalten" → email eintippen. ihr seht dann beide dieselben aufgaben + chat.',
          done: hasTeam),
        _OnboardStep(n: '3', title: 'mit team chatten',
          body: 'im team-tab könnt ihr nachrichten + notizen + termine teilen.',
          done: hasChat),
      ]),
    );
  }
}

// Reusable nav-row · icon · label · optionaler hint rechts · chevron.
class _NavRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String? hint;
  final VoidCallback onTap;
  const _NavRow({required this.icon, required this.label, required this.onTap, this.hint});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
        decoration: BoxDecoration(
          border: Border.all(color: pgInkFaint, width: 1.5),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(children: [
          Icon(icon, size: 18, color: pgInk),
          const SizedBox(width: 10),
          Expanded(child: Text(label,
            style: const TextStyle(fontSize: 13.5, color: pgInk))),
          if (hint != null) ...[
            Text(hint!,
              style: const TextStyle(fontSize: 11, color: pgInkFaint, fontFamily: 'monospace')),
            const SizedBox(width: 6),
          ],
          const Icon(Icons.chevron_right, size: 18, color: pgInkFaint),
        ]),
      ),
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
