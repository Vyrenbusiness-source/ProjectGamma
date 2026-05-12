// Domain · heuristische "KI"-Suggestion fuer Idee -> Aufgabe in einem Tap.
// Reine Dart-Logik, ohne Flutter-/Server-Abhaengigkeiten -> trivial testbar.

const _highKeys = ['dringend', 'urgent', 'asap', 'sofort', 'wichtig'];
const _lowKeys = ['vielleicht', 'mal', 'irgendwann', 'evtl', 'optional'];

/// AI-Vorschlag fuer eine Aufgabe abgeleitet aus rohem Idee-Text.
class TaskSuggestion {
  final String title;
  final String meta;
  final int priority; // 1..5; default 3

  const TaskSuggestion({
    required this.title,
    required this.meta,
    required this.priority,
  });

  Map<String, dynamic> toJson() => {
        'title': title,
        'meta': meta,
        'priority': priority,
      };
}

/// Liefert einen [TaskSuggestion] fuer [raw], oder `null` wenn leer.
///
/// Heuristik:
/// - high-keywords ("dringend", ...) -> priority 4, meta "hoch · ki-vorschlag"
/// - low-keywords  ("vielleicht", ...) -> priority 2, meta "niedrig · ki-vorschlag"
/// - sonst priority 3, meta "aus idee"
/// - title: erkannte keywords entfernt, getrimmt, erstes zeichen gross,
///   max 80 zeichen.
TaskSuggestion? aiSuggestTask(String raw) {
  final t = raw.trim();
  if (t.isEmpty) return null;

  final lower = t.toLowerCase();
  final isHigh = _highKeys.any(lower.contains);
  final isLow = !isHigh && _lowKeys.any(lower.contains);

  var cleaned = t;
  for (final k in [..._highKeys, ..._lowKeys]) {
    cleaned = cleaned.replaceAll(RegExp(k, caseSensitive: false), '');
  }
  cleaned = cleaned.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (cleaned.isEmpty) cleaned = t;

  final title = _capFirst(_truncate(cleaned, 80));
  if (isHigh) {
    return TaskSuggestion(title: title, meta: 'hoch · ki-vorschlag', priority: 4);
  }
  if (isLow) {
    return TaskSuggestion(title: title, meta: 'niedrig · ki-vorschlag', priority: 2);
  }
  return TaskSuggestion(title: title, meta: 'aus idee', priority: 3);
}

String _capFirst(String s) =>
    s.isEmpty ? s : (s[0].toUpperCase() + s.substring(1));

String _truncate(String s, int max) =>
    s.length <= max ? s : '${s.substring(0, max - 1).trimRight()}…';
