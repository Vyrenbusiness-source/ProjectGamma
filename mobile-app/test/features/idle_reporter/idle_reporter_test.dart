import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/idle_reporter/idle_reporter.dart';

void main() {
  group('IdleReporter', () {
    test('paused → erst nach threshold idle=true', () {
      final calls = <List<dynamic>>[];
      var now = 1000;
      void Function() noopCancel() => () {};
      late void Function() pendingFn;
      void Function() schedule(Duration d, void Function() fn) {
        pendingFn = fn;
        return noopCancel();
      }

      final r = IdleReporter(
        threshold: const Duration(minutes: 5),
        sendIdle: (idle, since) => calls.add([idle, since]),
        now: () => now,
        schedule: schedule,
      );

      r.appLifecycleChanged('paused');
      expect(calls, isEmpty);
      expect(r.isIdle, false);
      expect(r.pausedAt, 1000);

      now = 1000 + 5 * 60 * 1000;
      pendingFn();
      expect(calls, [[true, 1000]]);
      expect(r.isIdle, true);
    });

    test('resumed vor threshold → kein idle-send', () {
      final calls = <List<dynamic>>[];
      var canceled = false;
      void Function() schedule(Duration d, void Function() fn) {
        return () { canceled = true; };
      }

      final r = IdleReporter(
        threshold: const Duration(minutes: 5),
        sendIdle: (i, s) => calls.add([i, s]),
        now: () => 1000,
        schedule: schedule,
      );

      r.appLifecycleChanged('paused');
      r.appLifecycleChanged('resumed');
      expect(calls, isEmpty);
      expect(canceled, true);
      expect(r.pausedAt, null);
    });

    test('idle → resumed feuert sendIdle(false)', () {
      final calls = <List<dynamic>>[];
      var now = 1000;
      late void Function() pending;
      void Function() schedule(Duration d, void Function() fn) {
        pending = fn;
        return () {};
      }

      final r = IdleReporter(
        sendIdle: (i, s) => calls.add([i, s]),
        now: () => now,
        schedule: schedule,
      );

      r.appLifecycleChanged('paused');
      pending();
      now = 99999;
      r.appLifecycleChanged('resumed');

      expect(calls.length, 2);
      expect(calls[0][0], true);
      expect(calls[1][0], false);
      expect(calls[1][1], 99999);
      expect(r.isIdle, false);
    });

    test('mehrfaches paused → nur 1 timer/send', () {
      final calls = <List<dynamic>>[];
      var scheduleCount = 0;
      late void Function() pending;
      void Function() schedule(Duration d, void Function() fn) {
        scheduleCount++;
        pending = fn;
        return () {};
      }

      final r = IdleReporter(
        sendIdle: (i, s) => calls.add([i, s]),
        now: () => 500,
        schedule: schedule,
      );

      r.appLifecycleChanged('paused');
      r.appLifecycleChanged('paused');
      r.appLifecycleChanged('hidden');
      expect(scheduleCount, 1);

      pending();
      expect(calls, [[true, 500]]);
    });

    test('sendIdle wirft → kein crash', () {
      late void Function() pending;
      void Function() schedule(Duration d, void Function() fn) {
        pending = fn;
        return () {};
      }
      final r = IdleReporter(
        sendIdle: (_, __) => throw StateError('boom'),
        now: () => 0,
        schedule: schedule,
      );
      r.appLifecycleChanged('paused');
      expect(pending, returnsNormally);
      expect(r.isIdle, true);
    });

    test('dispose canceled pending timer', () {
      var canceled = false;
      void Function() schedule(Duration d, void Function() fn) {
        return () { canceled = true; };
      }
      final r = IdleReporter(
        sendIdle: (_, __) {},
        now: () => 0,
        schedule: schedule,
      );
      r.appLifecycleChanged('paused');
      r.dispose();
      expect(canceled, true);
      expect(r.isIdle, false);
      expect(r.pausedAt, null);
    });
  });
}
