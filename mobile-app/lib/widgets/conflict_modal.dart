// ConflictModal · zeigt einen pending-Konflikt (project.conflicts) als
// Bottom-Sheet mit zwei Vorschau-Kacheln (lokal/remote) und löst per
// Tap RESOLVE_CONFLICT via sync_client aus (gerätesynchron).
//
// Aufruf: showConflictModal(context, conflict).
// Logik (Auswahl, Payload-Bau, Sortierung) liegt in
// features/conflicts/conflict_resolver.dart und ist pure-dart getestet.

import 'package:flutter/material.dart';
import '../features/conflicts/conflict_resolver.dart';
import '../sync_client.dart';
import '../theme.dart';

Future<void> showConflictModal(BuildContext context, Conflict c) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: pgPaper,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (sheetCtx) => ConflictModal(conflict: c),
  );
}

class ConflictModal extends StatelessWidget {
  const ConflictModal({super.key, required this.conflict});
  final Conflict conflict;

  Future<void> _resolve(BuildContext ctx, ConflictChoice choice) async {
    final client = SyncClientScope.of(ctx);
    final payload = buildResolvePayload(
      conflictId: conflict.id,
      choice: choice,
    );
    await client.mutate('RESOLVE_CONFLICT', payload);
    if (ctx.mounted) Navigator.of(ctx).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16, 8, 16,
        MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(child: Container(
            width: 40, height: 4,
            margin: const EdgeInsets.symmetric(vertical: 8),
            color: pgInkFaint,
          )),
          const PgEyebrow('konflikt lösen'),
          const SizedBox(height: 6),
          Text(formatConflictLabel(conflict),
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          _ChoiceCard(
            label: 'lokal · ${conflict.localDevice}',
            value: previewFor(conflict, ConflictChoice.local),
            onTap: () => _resolve(context, ConflictChoice.local),
          ),
          const SizedBox(height: 8),
          _ChoiceCard(
            label: 'remote · ${conflict.remoteDevice}',
            value: previewFor(conflict, ConflictChoice.remote),
            onTap: () => _resolve(context, ConflictChoice.remote),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('später', style: TextStyle(color: pgInkSoft)),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({required this.label, required this.value, required this.onTap});
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: pgPaper2,
          border: Border.all(color: pgInk, width: 1.5),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label,
                style: const TextStyle(
                    fontSize: 11, color: pgInkSoft,
                    fontFamily: 'monospace', letterSpacing: 0.6)),
            const SizedBox(height: 4),
            Text(value,
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                maxLines: 4,
                overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );
  }
}
