// Mobile rule-diffs panel · UI-parität zur desktop-app/rule_diffs_panel.jsx.
//
// Zeigt pending cloud-code RULE_SUGGESTIONS (activate/deactivate) als
// bestätigungspflichtige liste. Tap auf ✓ → APPROVE_RULE_DIFF, ✕ → REJECT.
// Stil: sketchy B&W, an _IdeaTile / _RuleTile angelehnt.

import 'package:flutter/material.dart';
import '../../theme.dart';
import '../../sync_client.dart';
import 'rule_diffs_view_helpers.dart';

class RuleDiffsPanel extends StatelessWidget {
  final Map<String, dynamic> project;
  const RuleDiffsPanel({super.key, required this.project});

  @override
  Widget build(BuildContext context) {
    final pending = selectPending(project);
    if (pending.isEmpty) return const SizedBox.shrink();
    final pid = project['id'] as String;
    final client = SyncClientScope.of(context, listen: false);

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const PgEyebrow('cloud-code regel-vorschläge'),
            const SizedBox(width: 6),
            Text('· ${pending.length} offen',
                style: const TextStyle(
                    fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
          ]),
          const SizedBox(height: 6),
          PgBox(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            child: Column(
              children: [
                for (final d in pending)
                  _DiffRow(
                    diff: d,
                    onApprove: () => client.mutate('APPROVE_RULE_DIFF',
                        {'projectId': pid, 'diffId': d['id']}),
                    onReject: () => client.mutate('REJECT_RULE_DIFF',
                        {'projectId': pid, 'diffId': d['id']}),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DiffRow extends StatelessWidget {
  final Map<String, dynamic> diff;
  final VoidCallback onApprove;
  final VoidCallback onReject;
  const _DiffRow({
    required this.diff,
    required this.onApprove,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    final action = diff['action']?.toString() ?? '';
    final isDeactivate = action == 'deactivate';
    final actionColor = isDeactivate ? pgDanger : pgInk;
    final actionLabel = isDeactivate ? '− deaktivieren' : '+ aktivieren';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: pgPaper,
              border: Border.all(color: actionColor, width: 1.5),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Text(actionLabel,
                style: TextStyle(
                    color: actionColor,
                    fontFamily: 'monospace',
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600)),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              (diff['text'] ?? '').toString(),
              style: const TextStyle(fontSize: 13),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, color: pgInkFaint, size: 18),
            tooltip: 'ablehnen',
            onPressed: onReject,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
          ),
          IconButton(
            icon: const Icon(Icons.check, color: pgInk, size: 18),
            tooltip: 'bestätigen',
            onPressed: onApprove,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
          ),
        ],
      ),
    );
  }
}
