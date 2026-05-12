// Pure-Dart WS-Heartbeat + Exponential-Backoff-Reconnect.
//
// [computeBackoff] berechnet die Wartezeit für den n-ten Reconnect-Versuch:
//   attempt 1 → base, attempt 2 → base*factor, …, gecappt bei [max].
// ±[jitter] (z.b. 0.2 = ±20%) gegen Stampedes, wenn mehrere Geräte
// gleichzeitig die Verbindung verlieren.
//
// [HeartbeatMonitor] schedulet alle [pingInterval] einen [onPing]-tick und
// erwartet innerhalb [pongTimeout] ein [notePong]; sonst feuert [onTimeout]
// (aufrufer schließt dann ws → trigger reconnect). Timer-Factory ist
// injectable, damit ohne widget-tester testbar.
//
// Pure-Logik — keine Flutter-Imports.

import 'dart:async';
import 'dart:math' as math;

Duration computeBackoff(
  int attempt, {
  Duration base = const Duration(seconds: 1),
  double factor = 1.6,
  Duration max = const Duration(seconds: 30),
  double jitter = 0.2,
  double Function()? rng,
}) {
  final n = attempt < 1 ? 1 : attempt;
  final baseMs = base.inMilliseconds;
  final expMs = baseMs * math.pow(factor, n - 1);
  final cappedMs = math.min(max.inMilliseconds.toDouble(), expMs);
  final r = (rng ?? math.Random().nextDouble)();
  final jMs = (r * 2 - 1) * jitter * cappedMs;
  var outMs = (cappedMs + jMs).round();
  if (outMs < 0) outMs = 0;
  if (outMs > max.inMilliseconds) outMs = max.inMilliseconds;
  return Duration(milliseconds: outMs);
}

typedef HeartbeatTimer = void Function();
typedef HeartbeatScheduler = HeartbeatTimer Function(Duration d, void Function() fn);

HeartbeatTimer _defaultSchedule(Duration d, void Function() fn) {
  final t = Timer(d, fn);
  return t.cancel;
}

class HeartbeatMonitor {
  HeartbeatMonitor({
    this.pingInterval = const Duration(seconds: 25),
    this.pongTimeout = const Duration(seconds: 10),
    required this.onPing,
    required this.onTimeout,
    HeartbeatScheduler? schedule,
  }) : _schedule = schedule ?? _defaultSchedule;

  final Duration pingInterval;
  final Duration pongTimeout;
  final void Function() onPing;
  final void Function() onTimeout;
  final HeartbeatScheduler _schedule;

  HeartbeatTimer? _pingCancel;
  HeartbeatTimer? _pongCancel;
  bool _stopped = true;

  void start() {
    _stopped = false;
    _clearAll();
    _pingCancel = _schedule(pingInterval, _tick);
  }

  void stop() {
    _stopped = true;
    _clearAll();
  }

  void notePong() {
    final c = _pongCancel;
    if (c != null) { c(); _pongCancel = null; }
  }

  void _tick() {
    if (_stopped) return;
    onPing();
    _pongCancel = _schedule(pongTimeout, () {
      if (_stopped) return;
      _pongCancel = null;
      onTimeout();
    });
    _pingCancel = _schedule(pingInterval, _tick);
  }

  void _clearAll() {
    final p = _pingCancel; if (p != null) { p(); _pingCancel = null; }
    final q = _pongCancel; if (q != null) { q(); _pongCancel = null; }
  }
}
