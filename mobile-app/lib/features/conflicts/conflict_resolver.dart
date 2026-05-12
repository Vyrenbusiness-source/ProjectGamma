/// Pure-dart Helfer für die Konflikt-Resolution-UI.
///
/// Konflikte (`project.conflicts`) sind gerätesynchron — dieses Modul
/// formt nur Daten für das UI und baut RESOLVE_CONFLICT-Payloads.
/// Persistenz/Sync übernimmt der Aufrufer (sync_client).
/// Keine Flutter-Imports — testbar ohne widget-tester.
library;

enum ConflictChoice { local, remote }

class Conflict {
  Conflict({
    required this.id,
    required this.field,
    required this.localValue,
    required this.remoteValue,
    required this.localDevice,
    required this.remoteDevice,
    required this.detectedAt,
    this.status = 'pending',
  });

  final String id;
  final String field;
  final String localValue;
  final String remoteValue;
  final String localDevice;
  final String remoteDevice;
  final DateTime detectedAt;
  final String status;

  static Conflict fromJson(Map<String, dynamic> j) => Conflict(
        id: j['id'] as String,
        field: (j['field'] as String?) ?? '',
        localValue: (j['localValue'] as String?) ?? '',
        remoteValue: (j['remoteValue'] as String?) ?? '',
        localDevice: (j['localDevice'] as String?) ?? '',
        remoteDevice: (j['remoteDevice'] as String?) ?? '',
        detectedAt: DateTime.parse(j['detectedAt'] as String),
        status: (j['status'] as String?) ?? 'pending',
      );
}

/// Liefert nur pending-Konflikte (älteste zuerst — älteste blockt am ehesten).
List<Conflict> selectPending(List<Conflict>? all) {
  if (all == null) return const [];
  final pending = all.where((c) => c.status == 'pending').toList();
  pending.sort((a, b) => a.detectedAt.compareTo(b.detectedAt));
  return pending;
}

int countPending(List<Conflict>? all) => selectPending(all).length;

/// Menschen-lesbares Label (für Listendarstellung).
String formatConflictLabel(Conflict c) =>
    '${c.field}: ${c.localDevice} ↔ ${c.remoteDevice}';

/// Vorschau-Wert je nach Auswahl.
String previewFor(Conflict c, ConflictChoice choice) =>
    choice == ConflictChoice.local ? c.localValue : c.remoteValue;

/// Baut das Dispatch-Payload für RESOLVE_CONFLICT.
/// Wird via sync_client an den Server gesendet (gerätesynchron).
Map<String, dynamic> buildResolvePayload({
  required String conflictId,
  required ConflictChoice choice,
}) {
  if (conflictId.isEmpty) {
    throw ArgumentError.value(conflictId, 'conflictId', 'darf nicht leer sein');
  }
  return {
    'conflictId': conflictId,
    'choice': choice == ConflictChoice.local ? 'local' : 'remote',
  };
}
