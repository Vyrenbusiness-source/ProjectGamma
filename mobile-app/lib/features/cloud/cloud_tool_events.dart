// Live tool-events anzeige · was claude gerade tut.
// Renders aus sync_client.ccToolEvents[projectId].
// Stil: sketchy B&W, monospace, kompakt (max ~12 zeilen).

import 'package:flutter/material.dart';
import '../../theme.dart';

class CloudToolEvents extends StatelessWidget {
  final List<Map<String, dynamic>> events;
  final String? thinkingText;
  const CloudToolEvents({
    super.key, required this.events, this.thinkingText,
  });

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) return const SizedBox.shrink();
    // Default: nur letzte 5 zeigen → mobile-clutter vermeiden.
    // Running events priorisiert (sichtbar bleiben bis result kommt).
    final visible = events.length > 5 ? events.sublist(events.length - 5) : events;
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
      decoration: BoxDecoration(
        color: pgPaper,
        border: Border.all(color: pgInk, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            const Text('// tools · was claude tut',
                style: TextStyle(
                    fontFamily: 'monospace', fontSize: 10, color: pgInkSoft, letterSpacing: 1.2)),
            const Spacer(),
            if (thinkingText != null && thinkingText!.isNotEmpty)
              Flexible(child: Text(
                '💭 ${thinkingText!.length > 50 ? thinkingText!.substring(0, 50) + "…" : thinkingText!}',
                style: const TextStyle(
                    fontFamily: 'monospace', fontSize: 9.5, color: pgInkFaint, fontStyle: FontStyle.italic),
                overflow: TextOverflow.ellipsis,
              )),
          ]),
          const SizedBox(height: 4),
          for (final te in visible) _ToolRow(te: te),
        ],
      ),
    );
  }
}

class _ToolRow extends StatelessWidget {
  final Map<String, dynamic> te;
  const _ToolRow({required this.te});
  @override
  Widget build(BuildContext context) {
    final state = te['state']?.toString() ?? 'running';
    final isError = state == 'error';
    final isRunning = state == 'running';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [
        SizedBox(width: 16, child: Text(te['glyph']?.toString() ?? '•',
          style: const TextStyle(fontSize: 11), textAlign: TextAlign.center)),
        const SizedBox(width: 6),
        SizedBox(width: 64, child: Text(te['tool']?.toString() ?? '?',
          style: TextStyle(
            fontFamily: 'monospace', fontSize: 10.5, fontWeight: FontWeight.w600,
            color: isError ? pgDanger : pgInk))),
        Expanded(child: Text(te['summary']?.toString() ?? '',
            style: TextStyle(
              fontFamily: 'monospace', fontSize: 10.5,
              color: isError ? pgDanger : pgInk,
              ),
            maxLines: 1, overflow: TextOverflow.ellipsis)),
        Opacity(opacity: isRunning ? 0.6 : 1, child: Text(
          isRunning ? '…' : (isError ? '✗' : '✓'),
          style: TextStyle(
              fontFamily: 'monospace', fontSize: 10, color: isError ? pgDanger : pgInkFaint),
        )),
      ]),
    );
  }
}
