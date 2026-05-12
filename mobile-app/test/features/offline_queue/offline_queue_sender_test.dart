import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/offline_queue/offline_queue.dart';
import 'package:projectgamma_mobile/features/offline_queue/offline_queue_sender.dart';

void main() {
  group('drainAndSend', () {
    test('sendet pending in chronologischer reihenfolge und markiert sent', () async {
      final q = OfflineQueue();
      final a = q.enqueue(type: 'A', payload: {});
      final b = q.enqueue(type: 'B', payload: {});
      final sent = <String>[];
      final ok = await drainAndSend(
        queue: q,
        sender: (item) async {
          sent.add(item.id);
          return true;
        },
      );
      expect(ok, 2);
      expect(sent, [a.id, b.id]); // älteste zuerst
      expect(q.pending, isEmpty);
    });

    test('markiert failed bei sender-false und stoppt nicht', () async {
      final q = OfflineQueue();
      q.enqueue(type: 'A', payload: {});
      q.enqueue(type: 'B', payload: {});
      var n = 0;
      await drainAndSend(
        queue: q,
        sender: (_) async {
          n++;
          return n != 1; // erstes failed, zweites ok
        },
      );
      expect(q.pending, hasLength(0));
      expect(q.list.where((i) => i.status == QueueStatus.failed), hasLength(1));
      expect(q.list.where((i) => i.status == QueueStatus.sent), hasLength(1));
    });

    test('exception im sender wird als failed gespeichert', () async {
      final q = OfflineQueue();
      q.enqueue(type: 'A', payload: {});
      await drainAndSend(
        queue: q,
        sender: (_) async => throw StateError('boom'),
      );
      final failed = q.list.where((i) => i.status == QueueStatus.failed).toList();
      expect(failed, hasLength(1));
      expect(failed.single.error, contains('boom'));
    });
  });
}
