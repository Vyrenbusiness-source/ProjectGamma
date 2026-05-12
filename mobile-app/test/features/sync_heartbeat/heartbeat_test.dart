import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/sync_heartbeat/heartbeat.dart';

void main() {
  test('attempt 1 mit jitter=0 → base', () {
    final d = computeBackoff(
      1,
      base: const Duration(seconds: 1),
      factor: 1.6,
      jitter: 0,
      rng: () => 0.5,
    );
    expect(d, const Duration(seconds: 1));
  });

  test('attempt 5 mit jitter=0 → base*factor^4', () {
    final d = computeBackoff(
      5,
      base: const Duration(seconds: 1),
      factor: 1.6,
      jitter: 0,
      rng: () => 0.5,
    );
    expect(d.inMilliseconds, (1000 * 1.6 * 1.6 * 1.6 * 1.6).round());
  });

  test('cap = max bei großem attempt', () {
    final d = computeBackoff(
      100,
      base: const Duration(seconds: 1),
      factor: 2,
      max: const Duration(seconds: 30),
      jitter: 0,
      rng: () => 0.5,
    );
    expect(d, const Duration(seconds: 30));
  });

  test('attempt<=0 → base', () {
    final d = computeBackoff(0, jitter: 0, rng: () => 0.5);
    expect(d, const Duration(seconds: 1));
  });

  test('jitter hält cap und untergrenze ein', () {
    for (var i = 0; i < 50; i++) {
      final d = computeBackoff(
        50,
        base: const Duration(seconds: 1),
        factor: 2,
        max: const Duration(seconds: 30),
        jitter: 0.5,
      );
      expect(d.inMilliseconds, lessThanOrEqualTo(30000));
      expect(d.inMilliseconds, greaterThanOrEqualTo(0));
    }
  });

  group('HeartbeatMonitor', () {
    test('feuert onTimeout wenn notePong ausbleibt', () {
      final fired = <String>[];
      late void Function() pongCb;
      var pingCalls = 0;
      final mon = HeartbeatMonitor(
        pingInterval: const Duration(seconds: 25),
        pongTimeout: const Duration(seconds: 10),
        onPing: () => fired.add('ping'),
        onTimeout: () => fired.add('timeout'),
        schedule: (d, fn) {
          if (d == const Duration(seconds: 25)) {
            pingCalls++;
            if (pingCalls == 1) fn();
          } else {
            pongCb = fn;
          }
          return () {};
        },
      );
      mon.start();
      pongCb();
      expect(fired, ['ping', 'timeout']);
    });

    test('notePong verhindert onTimeout', () {
      final fired = <String>[];
      var cancelled = 0;
      var pingCalls = 0;
      final mon = HeartbeatMonitor(
        onPing: () => fired.add('ping'),
        onTimeout: () => fired.add('timeout'),
        schedule: (d, fn) {
          if (d == const Duration(seconds: 25)) {
            pingCalls++;
            if (pingCalls == 1) fn();
          }
          return () { cancelled++; };
        },
      );
      mon.start();
      mon.notePong();
      expect(fired, ['ping']);
      expect(cancelled, greaterThanOrEqualTo(1));
    });

    test('stop verhindert weiteren onTimeout-fire', () {
      final fired = <String>[];
      late void Function() pongCb;
      var pingCalls = 0;
      final mon = HeartbeatMonitor(
        onPing: () => fired.add('ping'),
        onTimeout: () => fired.add('timeout'),
        schedule: (d, fn) {
          if (d == const Duration(seconds: 25)) {
            pingCalls++;
            if (pingCalls == 1) fn();
          } else {
            pongCb = fn;
          }
          return () {};
        },
      );
      mon.start();
      mon.stop();
      pongCb();
      expect(fired, ['ping']);
    });
  });
}
