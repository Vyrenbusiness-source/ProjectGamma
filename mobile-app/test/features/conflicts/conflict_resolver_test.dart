import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/conflicts/conflict_resolver.dart';

Conflict _c(String id, {String status = 'pending', int min = 0}) => Conflict(
      id: id,
      field: 'title',
      localValue: 'A',
      remoteValue: 'B',
      localDevice: 'desktop',
      remoteDevice: 'mobile',
      detectedAt: DateTime.utc(2026, 5, 10, 12, min),
      status: status,
    );

void main() {
  group('selectPending', () {
    test('liefert nur pending, älteste zuerst', () {
      final list = [
        _c('c2', min: 5),
        _c('c1', min: 1),
        _c('c3', status: 'resolved', min: 0),
      ];
      final out = selectPending(list);
      expect(out.map((c) => c.id), ['c1', 'c2']);
    });
    test('null-input liefert leere liste', () {
      expect(selectPending(null), isEmpty);
    });
  });

  test('countPending zählt nur pending', () {
    expect(
      countPending([_c('a'), _c('b', status: 'resolved')]),
      1,
    );
  });

  test('formatConflictLabel zeigt feld + geräte', () {
    expect(formatConflictLabel(_c('x')), 'title: desktop ↔ mobile');
  });

  test('previewFor liefert korrekten wert', () {
    final c = _c('x');
    expect(previewFor(c, ConflictChoice.local), 'A');
    expect(previewFor(c, ConflictChoice.remote), 'B');
  });

  group('buildResolvePayload', () {
    test('serialisiert local/remote korrekt', () {
      expect(
        buildResolvePayload(conflictId: 'c1', choice: ConflictChoice.local),
        {'conflictId': 'c1', 'choice': 'local'},
      );
      expect(
        buildResolvePayload(conflictId: 'c1', choice: ConflictChoice.remote),
        {'conflictId': 'c1', 'choice': 'remote'},
      );
    });
    test('lehnt leere id ab', () {
      expect(
        () => buildResolvePayload(conflictId: '', choice: ConflictChoice.local),
        throwsArgumentError,
      );
    });
  });

  test('Conflict.fromJson liest pflichtfelder', () {
    final c = Conflict.fromJson({
      'id': 'c9',
      'field': 'desc',
      'localValue': 'x',
      'remoteValue': 'y',
      'localDevice': 'd1',
      'remoteDevice': 'd2',
      'detectedAt': '2026-05-10T12:00:00.000Z',
    });
    expect(c.id, 'c9');
    expect(c.status, 'pending');
  });
}
