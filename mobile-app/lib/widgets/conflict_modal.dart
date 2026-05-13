// ConflictModal · zeigt einen pending-Konflikt (project.conflicts) als
// Bottom-Sheet mit Side-by-Side-Diff (lokal | remote) und löst per Tap
// RESOLVE_CONFLICT via sync_client aus (gerätesynchron).
//
// Aufruf: showConflictModal(context, conflict).
// Logik (Auswahl, Payload-Bau, Sortierung) liegt in
// features/conflicts/conflict_resolver.dart, Diff-Zeilen kommen aus
// features/conflicts/conflict_diff.dart — beides pure-dart getestet.

import 'package:flutter/material.dart';
import '../features/conflicts/conflict_diff.dart';
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
    final rows = computeSideBySide(conflict.localValue, conflict.remoteValue);
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
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.45,
            ),
            child: SingleChildScrollView(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: _DiffColumn(
                    title: 'lokal · ${conflict.localDevice}',
                    rows: rows,
                    side: _Side.left,
                    onTap: () => _resolve(context, ConflictChoice.local),
                  )),
                  const SizedBox(width: 8),
                  Expanded(child: _DiffColumn(
                    title: 'remote · ${conflict.remoteDevice}',
                    rows: rows,
                    side: _Side.right,
                    onTap: () => _resolve(context, ConflictChoice.remote),
                  )),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(child: Text(
                'tipp auf seite → version übernehmen',
                style: TextStyle(fontSize: 11, color: pgInkSoft),
              )),
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('später', style: TextStyle(color: pgInkSoft)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

enum _Side { left, right }

class _DiffColumn extends StatelessWidget {
  const _DiffColumn({
    required this.title,
    required this.rows,
    required this.side,
    required this.onTap,
  });
  final String title;
  final List<DiffRow> rows;
  final _Side side;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: pgPaper2,
          border: Border.all(color: pgInk, width: 1.5),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              child: Text(title,
                  style: const TextStyle(
                      fontSize: 11, color: pgInkSoft,
                      fontFamily: 'monospace', letterSpacing: 0.6)),
            ),
            Container(height: 1, color: pgInkFaint),
            ...rows.isEmpty
                ? [const _DiffCell(kind: DiffKind.equal, text: '')]
                : rows.map((r) => _DiffCell(
                      kind: r.kind,
                      text: side == _Side.left ? r.left : r.right,
                    )),
          ],
        ),
      ),
    );
  }
}

class _DiffCell extends StatelessWidget {
  const _DiffCell({required this.kind, required this.text});
  final DiffKind kind;
  final String? text;

  Color get _bg => switch (kind) {
        DiffKind.remove => const Color(0x1AB42828),
        DiffKind.add => const Color(0x1A288C3C),
        DiffKind.change => const Color(0x1AB48C28),
        DiffKind.equal => const Color(0x00000000),
      };

  @override
  Widget build(BuildContext context) {
    final empty = text == null;
    return Container(
      width: double.infinity,
      color: _bg,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Text(
        empty ? '·' : text!,
        style: TextStyle(
          fontSize: 12,
          fontFamily: 'monospace',
          color: empty ? pgInkFaint : pgInk,
        ),
        softWrap: true,
      ),
    );
  }
}
