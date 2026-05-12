import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/swipe_undo/swipe_undo.dart';

void main() {
  group('inverseMutation', () {
    test('TOGGLE_TASK ist idempotent (selbe payload)', () {
      final inv = inverseMutation('TOGGLE_TASK', {'projectId': 'p1', 'taskId': 't1'});
      expect(inv?.type, 'TOGGLE_TASK');
      expect(inv?.payload, {'projectId': 'p1', 'taskId': 't1'});
    });

    test('DISMISS_IDEA wird zu REACTIVATE_IDEA', () {
      final inv = inverseMutation('DISMISS_IDEA', {'projectId': 'p1', 'ideaId': 'i9'});
      expect(inv?.type, 'REACTIVATE_IDEA');
      expect(inv?.payload['ideaId'], 'i9');
    });

    test('CONVERT_IDEA wird zu REACTIVATE_IDEA', () {
      final inv = inverseMutation('CONVERT_IDEA', {'projectId': 'p1', 'ideaId': 'i9'});
      expect(inv?.type, 'REACTIVATE_IDEA');
    });

    test('REACTIVATE_IDEA wird zu DISMISS_IDEA', () {
      final inv = inverseMutation('REACTIVATE_IDEA', {'projectId': 'p1', 'ideaId': 'i9'});
      expect(inv?.type, 'DISMISS_IDEA');
    });

    test('unbekannter Typ → null', () {
      expect(inverseMutation('FOO_BAR', const {}), isNull);
    });

    test('payload-kopie ist defensiv (kein alias)', () {
      final original = {'projectId': 'p1', 'taskId': 't1'};
      final inv = inverseMutation('TOGGLE_TASK', original)!;
      inv.payload['taskId'] = 'changed';
      expect(original['taskId'], 't1');
    });
  });

  group('UndoStack', () {
    UndoEntry mkEntry(String id, DateTime t) => UndoEntry(
          id: id,
          label: 'x',
          mutationType: 'TOGGLE_TASK',
          payload: const {},
          createdAt: t,
        );

    test('push + consume gibt eintrag, danach null', () {
      final s = UndoStack();
      s.push(mkEntry('a', DateTime.now()));
      expect(s.consume('a')?.id, 'a');
      expect(s.consume('a'), isNull);
    });

    test('active filtert abgelaufene', () {
      var t = DateTime.utc(2026, 5, 10, 12, 0, 0);
      final s = UndoStack(ttl: const Duration(seconds: 5), now: () => t);
      s.push(mkEntry('old', t.subtract(const Duration(seconds: 10))));
      s.push(mkEntry('new', t));
      expect(s.active.map((e) => e.id), ['new']);
    });

    test('purgeExpired entfernt physisch', () {
      var t = DateTime.utc(2026, 5, 10, 12, 0, 0);
      final s = UndoStack(ttl: const Duration(seconds: 5), now: () => t);
      s.push(mkEntry('old', t.subtract(const Duration(seconds: 10))));
      s.push(mkEntry('new', t));
      expect(s.purgeExpired(), 1);
      expect(s.size, 1);
    });

    test('UndoEntry.inverse delegiert an inverseMutation', () {
      final e = UndoEntry(
        id: 'x', label: 'l', mutationType: 'DISMISS_IDEA',
        payload: {'ideaId': 'i'}, createdAt: DateTime.now(),
      );
      expect(e.inverse?.type, 'REACTIVATE_IDEA');
    });
  });
}
