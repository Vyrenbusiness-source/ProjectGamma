/// Pure-dart Helper für Swipe-to-complete + Undo.
/// Kein Flutter-Import — testbar ohne widget-tester.
///
/// Public API:
///  * [inverseMutation] — liefert (type, payload) zur Umkehrung einer Mutation.
///  * [UndoEntry] — ein in der Snackbar offenes Undo-Element.
///  * [UndoStack] — verwaltet zuletzt geswipte Aktionen (single-shot).
library;

/// Berechnet die inverse Mutation, die ein User-Swipe rückgängig macht.
/// TOGGLE_TASK ist idempotent → einfach erneut toggeln.
/// DISMISS_IDEA ↔ REACTIVATE_IDEA. CONVERT_IDEA ↔ REACTIVATE_IDEA.
/// Gibt null zurück, wenn der Typ nicht umkehrbar ist.
({String type, Map<String, dynamic> payload})? inverseMutation(
  String type,
  Map<String, dynamic> payload,
) {
  switch (type) {
    case 'TOGGLE_TASK':
      return (type: 'TOGGLE_TASK', payload: Map<String, dynamic>.from(payload));
    case 'DISMISS_IDEA':
    case 'CONVERT_IDEA':
      return (type: 'REACTIVATE_IDEA', payload: Map<String, dynamic>.from(payload));
    case 'REACTIVATE_IDEA':
      return (type: 'DISMISS_IDEA', payload: Map<String, dynamic>.from(payload));
    default:
      return null;
  }
}

/// Beschreibt einen offenen Undo-Vorgang.
class UndoEntry {
  final String id;
  final String label;
  final String mutationType;
  final Map<String, dynamic> payload;
  final DateTime createdAt;

  UndoEntry({
    required this.id,
    required this.label,
    required this.mutationType,
    required this.payload,
    required this.createdAt,
  });

  /// Inverse Mutation für diesen Eintrag (null falls nicht umkehrbar).
  ({String type, Map<String, dynamic> payload})? get inverse =>
      inverseMutation(mutationType, payload);
}

/// In-Memory Stack mit Verfallszeit. Gerätelokal — wird nicht synchronisiert
/// (analog Theme/UI-State-Regel: Undo ist UI-State).
class UndoStack {
  final Duration ttl;
  final DateTime Function() _now;
  final List<UndoEntry> _entries = [];

  UndoStack({this.ttl = const Duration(seconds: 5), DateTime Function()? now})
      : _now = now ?? DateTime.now;

  void push(UndoEntry e) {
    _entries.add(e);
  }

  /// Aktive Einträge (noch nicht abgelaufen).
  List<UndoEntry> get active {
    final cutoff = _now().subtract(ttl);
    return _entries.where((e) => e.createdAt.isAfter(cutoff)).toList();
  }

  /// Pop by id — gibt Eintrag zurück und entfernt ihn.
  /// null, wenn nicht (mehr) gefunden.
  UndoEntry? consume(String id) {
    final ix = _entries.indexWhere((e) => e.id == id);
    if (ix < 0) return null;
    return _entries.removeAt(ix);
  }

  /// Entferne abgelaufene Einträge. Liefert Anzahl entfernter.
  int purgeExpired() {
    final cutoff = _now().subtract(ttl);
    final before = _entries.length;
    _entries.removeWhere((e) => !e.createdAt.isAfter(cutoff));
    return before - _entries.length;
  }

  int get size => _entries.length;
}
