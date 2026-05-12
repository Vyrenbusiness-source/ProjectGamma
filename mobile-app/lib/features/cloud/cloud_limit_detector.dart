/// Pure-dart helper: erkennt claude-api-limit aus den letzten activity-events.
/// Keine flutter-imports, damit ohne widget-tester testbar.
library;

/// Ergebnis der limit-erkennung: ob gehit, und optional die reset-zeit.
typedef LimitInfo = ({bool hit, String? resetText});

const _maxScan = 20;
const _hitMarkers = ['hit your limit', 'rate limit', 'usage limit'];

/// Scannt die obersten [_maxScan] events nach limit-markern + reset-zeit.
LimitInfo detectClaudeLimit(List<Map<String, dynamic>> activity) {
  final top = activity.take(_maxScan);
  final hit = top.any((e) {
    final text = (e['text']?.toString() ?? '').toLowerCase();
    return _hitMarkers.any(text.contains);
  });
  if (!hit) return (hit: false, resetText: null);
  final match = RegExp(r'resets ([0-9:apm ]+)', caseSensitive: false)
      .firstMatch(top.map((e) => e['text']?.toString() ?? '').join(' '));
  return (hit: true, resetText: match?.group(1)?.trim());
}
