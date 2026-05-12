// Inline-Suggest-Row: KI-Vorschlag fuer Idee->Aufgabe als Ein-Tap-Akzept-Target.
// Pure-Widget-Wrapper um aiSuggestTask + sync.mutate. Keine eigene Logik.
import 'package:flutter/material.dart';
import '../../sync_client.dart';
import '../../theme.dart';
import 'ai_suggest_task.dart';

/// Tappbarer Vorschlag-Chip; ein Tap akzeptiert die KI-Suggestion und
/// dispatcht CONVERT_IDEA (mit title/meta/priority) + ADD_SYNC_LOG.
class InlineSuggestRow extends StatelessWidget {
  final String projectId;
  final String ideaId;
  final String ideaText;
  final String source; // 'mobile' | 'desktop'

  const InlineSuggestRow({
    super.key,
    required this.projectId,
    required this.ideaId,
    required this.ideaText,
    this.source = 'mobile',
  });

  @override
  Widget build(BuildContext context) {
    final s = aiSuggestTask(ideaText);
    if (s == null) return const SizedBox.shrink();
    final client = SyncClientScope.of(context, listen: false);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: () async {
          await client.mutate('CONVERT_IDEA', {
            'projectId': projectId,
            'ideaId': ideaId,
            'title': s.title,
            'meta': s.meta,
            'priority': s.priority,
          });
          await client.mutate('ADD_SYNC_LOG', {
            'entry': {
              'source': source,
              'projectId': projectId,
              'text': 'idee „$ideaText" → aufgabe (ki: ${s.priority})',
            },
          });
        },
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
          decoration: BoxDecoration(
            color: pgPaper,
            border: Border.all(color: pgInk, width: 1.5),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('✓ ',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              Flexible(
                child: Text(
                  'als aufgabe: „${s.title}" · prio ${s.priority}',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
