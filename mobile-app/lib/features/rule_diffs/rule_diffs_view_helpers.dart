// Pure-Dart helpers für das Mobile-rule_diffs-panel.
// Spiegelt desktop-app/rule_diffs_view_helpers.js — gleiche signatur,
// gleiche semantik. Liegt isoliert, damit ohne flutter-bindings testbar.

/// Liefert nur pending diff-Einträge aus einem project-map (wie vom server
/// kommt: dynamic JSON).
List<Map<String, dynamic>> selectPending(Map<String, dynamic>? project) {
  if (project == null) return const [];
  final raw = project['ruleDiffs'];
  if (raw is! List) return const [];
  return raw
      .whereType<Map>()
      .map((e) => e.cast<String, dynamic>())
      .where((d) => d['status'] == 'pending')
      .toList(growable: false);
}

/// Anzahl pending diffs — für badge/chip im UI.
int countPending(Map<String, dynamic>? project) => selectPending(project).length;

/// Menschen-lesbares label, z.B. „aktivieren: kein unnötiger code".
String formatDiffLabel(Map<String, dynamic>? diff) {
  if (diff == null) return '';
  final text = (diff['text'] ?? '').toString();
  switch (diff['action']) {
    case 'activate':
      return 'aktivieren: $text';
    case 'deactivate':
      return 'deaktivieren: $text';
    default:
      return 'änderung: $text';
  }
}
