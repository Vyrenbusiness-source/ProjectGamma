import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/offline_queue/offline_queue.dart';

void main() {
  test('enqueue erzeugt id, status pending, optimistisches item', () {
    final q = OfflineQueue(now: () => DateTime.utc(2026, 5, 10));
    final item = q.enqueue(type: 'CREATE_IDEA', payload: {'text': 'a'});
    expect(item.id, isNotEmpty);
    expect(item.status, QueueStatus.pending);
    expect(item.type, 'CREATE_IDEA');
    expect(q.pending, hasLength(1));
  });

  test('drainPending gibt nur pending, markSent entfernt', () {
    final q = OfflineQueue();
    final a = q.enqueue(type: 'X', payload: {});
    final b = q.enqueue(type: 'Y', payload: {});
    expect(q.drainPending().map((i) => i.id), [a.id, b.id]);
    q.markSent(a.id);
    expect(q.pending.map((i) => i.id), [b.id]);
    expect(q.list.where((i) => i.status == QueueStatus.sent), hasLength(1));
  });

  test('markFailed setzt error + retryCount, retry resetzt zu pending', () {
    final q = OfflineQueue();
    final a = q.enqueue(type: 'X', payload: {});
    q.markFailed(a.id, 'net');
    final failed = q.list.firstWhere((i) => i.id == a.id);
    expect(failed.status, QueueStatus.failed);
    expect(failed.error, 'net');
    expect(failed.retryCount, 1);
    q.retry(a.id);
    expect(q.list.firstWhere((i) => i.id == a.id).status, QueueStatus.pending);
  });

  test('max-cap dropt älteste sent-items, behält pending', () {
    final q = OfflineQueue(max: 2);
    final a = q.enqueue(type: 'X', payload: {});
    q.markSent(a.id);
    q.enqueue(type: 'Y', payload: {});
    q.enqueue(type: 'Z', payload: {});
    expect(q.list.map((i) => i.type), ['Z', 'Y']);
  });

  test('toJson/fromJson rundet komplette queue', () {
    final q = OfflineQueue(now: () => DateTime.utc(2026, 5, 10));
    q.enqueue(type: 'X', payload: {'k': 1});
    final restored = OfflineQueue.fromJson(q.toJson());
    expect(restored.list, hasLength(1));
    expect(restored.list.first.payload, {'k': 1});
  });

  test('invalide enqueue-eingaben werfen ArgumentError', () {
    final q = OfflineQueue();
    expect(() => q.enqueue(type: '', payload: {}), throwsArgumentError);
  });
}
