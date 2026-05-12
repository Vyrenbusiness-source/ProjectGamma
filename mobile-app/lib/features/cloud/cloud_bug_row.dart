import 'package:flutter/material.dart';
import '../../theme.dart';
import '../../sync_client.dart';
import 'cloud_action_chips.dart';

const Color _sevWarn = Color(0xFFCC8800);

/// Zeile in der bugs-section: severity, location, fixen→task / verwerfen.
/// Fix-flow: ADD_TASK (group via target-picker) + SET_BUG_STATUS=fixing.
class CloudBugRow extends StatefulWidget {
  final String projectId;
  final Map<String, dynamic> bug;
  const CloudBugRow({super.key, required this.projectId, required this.bug});
  @override
  State<CloudBugRow> createState() => _CloudBugRowState();
}

class _CloudBugRowState extends State<CloudBugRow> {
  String _target = 'next';

  @override
  Widget build(BuildContext context) {
    final c = SyncClientScope.of(context);
    final b = widget.bug;
    final pending = b['status'] == 'pending';
    final sev = b['severity']?.toString() ?? 'medium';
    final sevColor = sev == 'high' ? pgDanger : sev == 'medium' ? _sevWarn : pgInkSoft;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              border: Border.all(color: sevColor, width: 1.5),
              borderRadius: BorderRadius.circular(8)),
            child: Text(sev, style: TextStyle(
              fontFamily: 'monospace', fontSize: 9, color: sevColor)),
          ),
          const SizedBox(width: 6),
          Expanded(child: Text(b['location']?.toString() ?? '',
            style: const TextStyle(
              fontFamily: 'monospace', fontSize: 9.5, color: pgInkSoft),
            overflow: TextOverflow.ellipsis)),
        ]),
        const SizedBox(height: 3),
        Text(b['description']?.toString() ?? '',
          style: const TextStyle(fontSize: 12.5, height: 1.4)),
        if (pending) ...[
          const SizedBox(height: 6),
          Wrap(spacing: 4, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
            CloudTargetChip(label: 'in arbeit', active: _target == 'in_progress',
              onTap: () => setState(() => _target = 'in_progress')),
            CloudTargetChip(label: 'als nächstes', active: _target == 'next',
              onTap: () => setState(() => _target = 'next')),
            CloudMiniBtn(
              label: '⚡ fixen',
              primary: true,
              onTap: () async {
                await c.mutate('ADD_TASK', {'projectId': widget.projectId, 'task': {
                  'title': '[bug] ${b['description']}',
                  'done': false, 'group': _target,
                  'meta': 'bug · ${b['severity']}',
                  'priority': b['severity'] == 'high'
                    ? 5 : b['severity'] == 'medium' ? 4 : 3,
                  'subtasks': [],
                }});
                await c.mutate('SET_BUG_STATUS', {
                  'projectId': widget.projectId,
                  'bugId': b['id'], 'status': 'fixing'});
              },
            ),
            CloudMiniBtn(
              label: '✕',
              onTap: () => c.mutate('SET_BUG_STATUS', {
                'projectId': widget.projectId,
                'bugId': b['id'], 'status': 'dismissed'}),
            ),
          ]),
        ],
      ]),
    );
  }
}
