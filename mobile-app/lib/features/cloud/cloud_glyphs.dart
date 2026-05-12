// Pure-dart Helper für cloud-screen: event-glyphen, sync-source-icons, relative zeit.
// Öffentlich, weil von mehreren cloud-feature-widgets genutzt.

/// Glyph für activity-event-typen (write/check/read/warn/edit/sync/rule/info).
String cloudGlyph(String? t) => switch (t) {
  'write' => '●', 'check' => '✓', 'read' => '►', 'warn' => '!',
  'edit' => '✎', 'sync' => '↻', 'rule' => '⚖', 'info' => 'ⓘ', _ => '·',
};

/// Icon für sync-log-quellen (mobile/desktop/cloud/system).
String cloudSourceIcon(String? s) => switch (s) {
  'mobile' => '📱→', 'desktop' => '💻→', 'cloud' => '☁',
  'system' => '!', _ => '·',
};

/// Relative zeit-darstellung (jetzt / 12s / 5m / 3h / 2d).
String cloudRelTime(int? ts) {
  if (ts == null) return '—';
  final s = (DateTime.now().millisecondsSinceEpoch - ts) ~/ 1000;
  if (s < 5) return 'jetzt';
  if (s < 60) return '${s}s';
  if (s < 3600) return '${s ~/ 60}m';
  if (s < 86400) return '${s ~/ 3600}h';
  return '${s ~/ 86400}d';
}
