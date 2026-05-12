// Dismissible-Wrapper für Tasks/Ideen mit Undo-Snackbar.
// Respektiert MediaQuery.disableAnimations (a11y).
import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import '../features/swipe_undo/swipe_undo.dart';

class SwipeToComplete extends StatelessWidget {
  /// Stable key (z.b. taskId/ideaId).
  final String itemKey;

  /// Die Mutation, die beim Swipe ausgelöst wird (z.b. TOGGLE_TASK).
  final String mutationType;
  final Map<String, dynamic> payload;

  /// Label in der Snackbar (z.b. „aufgabe erledigt").
  final String snackLabel;

  /// Hintergrundfarbe der Swipe-Aktion (default pgInk).
  final Color background;

  /// Icon links (Swipe right) bzw. rechts (Swipe left).
  final IconData icon;

  /// Wird nur in eine Richtung erlaubt (default endToStart = rechts→links).
  final DismissDirection direction;

  final Widget child;

  const SwipeToComplete({
    super.key,
    required this.itemKey,
    required this.mutationType,
    required this.payload,
    required this.snackLabel,
    required this.child,
    this.background = pgInk,
    this.icon = Icons.check,
    this.direction = DismissDirection.endToStart,
  });

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.of(context).disableAnimations;
    return Dismissible(
      key: ValueKey('swipe_$itemKey'),
      direction: direction,
      movementDuration: reduceMotion ? Duration.zero : const Duration(milliseconds: 180),
      resizeDuration: reduceMotion ? Duration.zero : const Duration(milliseconds: 220),
      background: _bg(alignEnd: false),
      secondaryBackground: _bg(alignEnd: true),
      onDismissed: (_) => _onDismissed(context),
      child: child,
    );
  }

  Widget _bg({required bool alignEnd}) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 18),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(6),
        ),
        alignment: alignEnd ? Alignment.centerRight : Alignment.centerLeft,
        child: Icon(icon, color: pgPaper),
      );

  void _onDismissed(BuildContext context) {
    final client = SyncClientScope.of(context, listen: false);
    client.mutate(mutationType, payload);
    final inv = inverseMutation(mutationType, payload);
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(SnackBar(
      duration: const Duration(seconds: 4),
      backgroundColor: pgInk,
      content: Text(snackLabel, style: const TextStyle(color: pgPaper)),
      action: inv == null
          ? null
          : SnackBarAction(
              label: 'rückgängig',
              textColor: pgPaper,
              onPressed: () => client.mutate(inv.type, inv.payload),
            ),
    ));
  }
}
