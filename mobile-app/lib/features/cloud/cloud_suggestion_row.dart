import 'package:flutter/material.dart';
import '../../theme.dart';
import '../../sync_client.dart';
import 'cloud_action_chips.dart';

/// Zeile in der vorschläge-section: kategorie, effort, akzeptieren→task / verwerfen.
/// Akzept-flow: ADD_TASK (group via target-picker) + SET_SUGGESTION_STATUS=accepted.
class CloudSuggestionRow extends StatefulWidget {
  final String projectId;
  final Map<String, dynamic> suggestion;
  const CloudSuggestionRow({super.key, required this.projectId, required this.suggestion});
  @override
  State<CloudSuggestionRow> createState() => _CloudSuggestionRowState();
}

class _CloudSuggestionRowState extends State<CloudSuggestionRow> {
  String _target = 'next';

  @override
  Widget build(BuildContext context) {
    final c = SyncClientScope.of(context);
    final s = widget.suggestion;
    final pending = s['status'] == 'pending';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          PgChip(s['category']?.toString() ?? '?'),
          const SizedBox(width: 4),
          PgChip(s['effort']?.toString() ?? '?'),
          const Spacer(),
          if (!pending) Text(s['status']?.toString().toUpperCase() ?? '',
            style: const TextStyle(
              fontSize: 9, color: pgInkFaint,
              fontFamily: 'monospace', letterSpacing: 1)),
        ]),
        const SizedBox(height: 4),
        Text(s['title']?.toString() ?? '',
          style: TextStyle(
            fontSize: 13, height: 1.35,
            color: pending ? pgInk : pgInkFaint,
            decoration: s['status'] == 'rejected' ? TextDecoration.lineThrough : null)),
        if (pending) ...[
          const SizedBox(height: 6),
          Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            CloudTargetChip(label: 'in arbeit', active: _target == 'in_progress',
              onTap: () => setState(() => _target = 'in_progress')),
            CloudTargetChip(label: 'als nächstes', active: _target == 'next',
              onTap: () => setState(() => _target = 'next')),
            CloudMiniBtn(
              label: '✓ aufgabe',
              primary: true,
              onTap: () async {
                await c.mutate('ADD_TASK', {'projectId': widget.projectId, 'task': {
                  'title': s['title'], 'done': false, 'group': _target,
                  'meta': 'vorschlag · ${s['category']}',
                  'priority': s['effort'] == 'low' ? 4 : s['effort'] == 'high' ? 2 : 3,
                  'subtasks': [],
                }});
                await c.mutate('SET_SUGGESTION_STATUS', {
                  'projectId': widget.projectId,
                  'suggestionId': s['id'], 'status': 'accepted'});
              },
            ),
            CloudMiniBtn(
              label: '✕',
              onTap: () => c.mutate('SET_SUGGESTION_STATUS', {
                'projectId': widget.projectId,
                'suggestionId': s['id'], 'status': 'rejected'}),
            ),
          ]),
        ],
      ]),
    );
  }
}
