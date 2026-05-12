import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/rule_diffs/rule_diffs_view_helpers.dart';

void main() {
  group('selectPending', () {
    test('leer wenn project null', () {
      expect(selectPending(null), isEmpty);
    });
    test('leer wenn ruleDiffs fehlt', () {
      expect(selectPending(<String, dynamic>{}), isEmpty);
    });
    test('filtert nicht-pending raus', () {
      final p = {
        'ruleDiffs': [
          {'id': '1', 'status': 'pending', 'text': 'a'},
          {'id': '2', 'status': 'approved', 'text': 'b'},
          {'id': '3', 'status': 'rejected', 'text': 'c'},
          {'id': '4', 'status': 'pending', 'text': 'd'},
        ],
      };
      final out = selectPending(p);
      expect(out, hasLength(2));
      expect(out.map((d) => d['id']), containsAll(['1', '4']));
    });
  });

  group('countPending', () {
    test('liefert 0 bei null/empty', () {
      expect(countPending(null), 0);
      expect(countPending(<String, dynamic>{}), 0);
    });
    test('zählt nur pending', () {
      final p = {
        'ruleDiffs': [
          {'status': 'pending'}, {'status': 'pending'}, {'status': 'approved'},
        ],
      };
      expect(countPending(p), 2);
    });
  });

  group('formatDiffLabel', () {
    test('null → leer', () {
      expect(formatDiffLabel(null), '');
    });
    test('activate-action', () {
      expect(formatDiffLabel({'action': 'activate', 'text': 'foo'}),
          'aktivieren: foo');
    });
    test('deactivate-action', () {
      expect(formatDiffLabel({'action': 'deactivate', 'text': 'foo'}),
          'deaktivieren: foo');
    });
    test('unbekannte action → fallback', () {
      expect(formatDiffLabel({'action': 'wat', 'text': 'foo'}),
          'änderung: foo');
    });
  });
}
