/// Drain-Helper für [OfflineQueue]: pure-dart, ohne Flutter-Imports,
/// damit der Reconnect-Flow von [SyncClient] ohne widget-tester testbar bleibt.
library;

import 'offline_queue.dart';

/// Sendet alle pending-Items in chronologischer Reihenfolge (ältester zuerst).
/// [sender] muss `true` zurückgeben, wenn der Versand erfolgreich war.
///
/// Returnt die Anzahl erfolgreich gesendeter Items. Fehler werden pro Item
/// als [QueueStatus.failed] (mit Fehlermeldung) markiert, der Drain bricht
/// nicht ab — sonst blockiert ein einzelnes kaputtes Item die ganze Queue.
Future<int> drainAndSend({
  required OfflineQueue queue,
  required Future<bool> Function(QueueItem item) sender,
}) async {
  var ok = 0;
  for (final item in queue.drainPending()) {
    try {
      final success = await sender(item);
      if (success) {
        queue.markSent(item.id);
        ok++;
      } else {
        queue.markFailed(item.id, 'sender returned false');
      }
    } catch (e) {
      queue.markFailed(item.id, e.toString());
    }
  }
  return ok;
}
