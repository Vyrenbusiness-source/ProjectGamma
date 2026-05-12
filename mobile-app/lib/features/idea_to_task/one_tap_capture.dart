// UI-Glue · 1-Tap "Idee -> Aufgabe" inkl. KI-Vorschlag.
// Bewusst klein: Button-Widget + ein Use-Case-Helper. Keine eigenen Mutationen
// auf dem Server -> nutzt bestehende ADD_IDEA + ADD_TASK + ADD_SYNC_LOG.

import 'package:flutter/material.dart';
import '../../sync_client.dart';
import '../../theme.dart';
import 'ai_suggest_task.dart';

/// Erstellt aus rohem Idee-Text in einem Schritt:
/// - eine Idee mit `status: task_created` (Audit/Verlauf bleibt erhalten)
/// - eine Aufgabe mit KI-vorgeschlagenem Titel/Priority
/// - einen Sync-Log-Eintrag fuer beide Geraete.
///
/// Liefert das genutzte [TaskSuggestion], oder `null` falls Text leer war.
Future<TaskSuggestion?> captureIdeaAsTask(
  SyncClient client,
  String projectId,
  String rawText,
) async {
  final s = aiSuggestTask(rawText);
  if (s == null) return null;
  final raw = rawText.trim();
  await client.mutate('ADD_IDEA', {
    'projectId': projectId,
    'idea': {'text': raw, 'source': 'mobile', 'status': 'task_created'},
  });
  await client.mutate('ADD_TASK', {
    'projectId': projectId,
    'task': {
      'title': s.title,
      'meta': s.meta,
      'priority': s.priority,
      'group': 'next',
      'done': false,
    },
  });
  await client.mutate('ADD_SYNC_LOG', {
    'entry': {
      'source': 'mobile',
      'text': 'idee „$raw" → aufgabe (ki: ${s.priority})',
      'projectId': projectId,
    },
  });
  return s;
}

/// Sekundaer-Button im Quick-Capture: ein Tap statt zwei.
class OneTapTaskButton extends StatefulWidget {
  final String Function() readText;
  final VoidCallback onAfter;
  const OneTapTaskButton({
    super.key,
    required this.readText,
    required this.onAfter,
  });

  @override
  State<OneTapTaskButton> createState() => _OneTapTaskButtonState();
}

class _OneTapTaskButtonState extends State<OneTapTaskButton> {
  bool _busy = false;

  Future<void> _go() async {
    final txt = widget.readText();
    if (txt.trim().isEmpty || _busy) return;
    setState(() => _busy = true);
    final client = SyncClientScope.of(context, listen: false);
    final p = client.activeProject;
    final messenger = ScaffoldMessenger.maybeOf(context);
    TaskSuggestion? s;
    try {
      if (p != null) {
        s = await captureIdeaAsTask(client, p['id'] as String, txt);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    widget.onAfter();
    if (mounted && s != null) {
      messenger?.showSnackBar(
        SnackBar(
          duration: const Duration(milliseconds: 1800),
          content: Text('aufgabe: „${s.title}" · prio ${s.priority}'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: _busy ? null : _go,
      style: OutlinedButton.styleFrom(
        foregroundColor: pgInk,
        side: const BorderSide(color: pgInk, width: 1.5),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
      child: _busy
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(color: pgInk, strokeWidth: 2),
            )
          : const Text('→ aufgabe', style: TextStyle(fontSize: 13)),
    );
  }
}
