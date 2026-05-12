'use strict';

// WS-Heartbeat + Exponential-Backoff-Reconnect (pure helpers).
//
// computeBackoff(attempt, opts) → ms-delay für reconnect-versuch.
//   Exponentiell (base * factor^attempt), gecappt bei max, mit symmetrischem
//   ±jitter (z.b. 0.2 ⇒ ±20%) gegen reconnect-stampedes wenn mehrere clients
//   gleichzeitig die verbindung verlieren.
//
// createHeartbeatMonitor({pingInterval, pongTimeout, onPing, onTimeout, ...})
//   start() schedulet alle pingInterval ms einen onPing-tick und erwartet
//   innerhalb pongTimeout ms ein notePong(); ansonsten feuert onTimeout()
//   (aufrufer schließt dann ws → trigger reconnect). setTimer/clearTimer/now
//   sind injectable, damit ohne dom testbar.
//
// Public API: computeBackoff, createHeartbeatMonitor.

function computeBackoff(attempt, opts = {}) {
  const base = opts.base ?? 1000;
  const factor = opts.factor ?? 1.6;
  const max = opts.max ?? 30000;
  const jitter = opts.jitter ?? 0.2;
  const rng = opts.rng ?? Math.random;
  const n = Math.max(1, attempt | 0);
  // attempt 1 → base, attempt 2 → base*factor, …
  const expDelay = base * Math.pow(factor, n - 1);
  const capped = Math.min(max, expDelay);
  const j = (rng() * 2 - 1) * jitter * capped;
  const out = Math.round(capped + j);
  if (out < 0) return 0;
  if (out > max) return max;
  return out;
}

function createHeartbeatMonitor(opts) {
  const pingInterval = opts.pingInterval ?? 25000;
  const pongTimeout = opts.pongTimeout ?? 10000;
  const onPing = opts.onPing || (() => {});
  const onTimeout = opts.onTimeout || (() => {});
  const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer || ((t) => clearTimeout(t));

  let pingT = null;
  let pongT = null;
  let stopped = true;

  function clearAll() {
    if (pingT != null) { clearTimer(pingT); pingT = null; }
    if (pongT != null) { clearTimer(pongT); pongT = null; }
  }

  function tick() {
    if (stopped) return;
    onPing();
    pongT = setTimer(() => {
      if (stopped) return;
      pongT = null;
      onTimeout();
    }, pongTimeout);
    pingT = setTimer(tick, pingInterval);
  }

  return {
    start() {
      stopped = false;
      clearAll();
      pingT = setTimer(tick, pingInterval);
    },
    stop() {
      stopped = true;
      clearAll();
    },
    notePong() {
      if (pongT != null) { clearTimer(pongT); pongT = null; }
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeBackoff, createHeartbeatMonitor };
}
if (typeof window !== 'undefined') {
  window.computeBackoff = computeBackoff;
  window.createHeartbeatMonitor = createHeartbeatMonitor;
}
