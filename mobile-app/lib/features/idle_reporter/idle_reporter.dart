// Idle-reporter (pure-Dart helper, keine Flutter-imports).
//
// Bekommt lifecycle-events vom binding (paused / resumed / inactive /
// detached / hidden) und entscheidet, wann der client als "idle" gilt:
// paused-dauer >= [threshold] (default 5min, entspricht screen-off). Erst
// dann ruft er [sendIdle](true) auf. Bei resumed sofort [sendIdle](false).
//
// Pure logik — clock + scheduler sind injectable, damit testbar ohne
// echte timer. UI/networking-integration sitzt außerhalb (siehe
// AppLifecycleObserver in main.dart, der nur appLifecycleChanged()
// weiterleitet).
//
// Public API: IdleReporter({ threshold, sendIdle, now, schedule }).
//   appLifecycleChanged('paused'|'resumed'|...) → state-update.
//   dispose() → timer canceln, idle=false zurücksetzen (kein send).

import 'dart:async';

typedef IdleSender = void Function(bool idle, int sinceMs);
typedef IdleScheduler = void Function() Function(Duration d, void Function() fn);

void Function() _defaultSchedule(Duration d, void Function() fn) {
  final t = Timer(d, fn);
  return t.cancel;
}

class IdleReporter {
  IdleReporter({
    this.threshold = const Duration(minutes: 5),
    required this.sendIdle,
    int Function()? now,
    IdleScheduler? schedule,
  })  : _now = now ?? (() => DateTime.now().millisecondsSinceEpoch),
        _schedule = schedule ?? _defaultSchedule;

  final Duration threshold;
  final IdleSender sendIdle;
  final int Function() _now;
  final IdleScheduler _schedule;

  int? _pausedAt;
  bool _idle = false;
  void Function()? _cancelPending;

  bool get isIdle => _idle;
  int? get pausedAt => _pausedAt;

  void appLifecycleChanged(String state) {
    final s = state.toLowerCase();
    if (s == 'paused' || s == 'hidden' || s == 'inactive') {
      _onPaused();
    } else if (s == 'resumed') {
      _onResumed();
    } else if (s == 'detached') {
      _onResumed();
    }
  }

  void _onPaused() {
    if (_pausedAt != null) return;
    _pausedAt = _now();
    _cancelPending?.call();
    _cancelPending = _schedule(threshold, _markIdle);
  }

  void _onResumed() {
    _cancelPending?.call();
    _cancelPending = null;
    _pausedAt = null;
    if (_idle) {
      _idle = false;
      _safeSend(false, _now());
    }
  }

  void _markIdle() {
    _cancelPending = null;
    final p = _pausedAt;
    if (p == null || _idle) return;
    _idle = true;
    _safeSend(true, p);
  }

  void _safeSend(bool idle, int since) {
    try { sendIdle(idle, since); } catch (_) {}
  }

  void dispose() {
    _cancelPending?.call();
    _cancelPending = null;
    _pausedAt = null;
    _idle = false;
  }
}
