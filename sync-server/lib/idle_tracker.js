'use strict';

// Idle-Tracker (pure helper, ohne fs/network).
//
// Hält pro session-token den letzten gemeldeten idle-zustand
// (mobile: screen-off > 5min, desktop: tab-hidden / lock-proxy).
// allIdle() ist true wenn mindestens 1 session bekannt ist und alle
// bekannten sessions idle=true gemeldet haben — sync-server triggert
// dann den auto-pump SOFORT (statt 10s-tick zu warten), weil der user
// gerade nicht aktiv ist.
//
// Übergang active→all-idle ruft onAllIdle einmal auf; bleibt all-idle
// noch true und weitere clients melden idle=true, feuert es NICHT
// erneut. Erst wenn mindestens 1 client wieder active wird und danach
// die gruppe wieder komplett idle kippt, gibt es einen neuen call.
//
// Public API: createIdleTracker({ onAllIdle? }) → { setIdle, removeSession,
//   allIdle, idleCount, activeCount, snapshot }.

function createIdleTracker(opts = {}) {
  const onAllIdle = opts.onAllIdle || (() => {});
  // token -> { idle: bool, since: number|null }
  const sessions = new Map();
  let lastAllIdle = false;

  function _checkAllIdle() {
    if (sessions.size === 0) return false;
    for (const s of sessions.values()) {
      if (!s.idle) return false;
    }
    return true;
  }

  function _maybeFire() {
    const now = _checkAllIdle();
    if (now && !lastAllIdle) {
      lastAllIdle = true;
      try { onAllIdle(); } catch (_) { /* nicht propagieren */ }
    } else if (!now) {
      lastAllIdle = false;
    }
  }

  return {
    setIdle(token, idle, since) {
      if (!token) return;
      const safeIdle = idle === true;
      const safeSince = (typeof since === 'number') ? since : null;
      sessions.set(token, { idle: safeIdle, since: safeSince });
      _maybeFire();
    },
    removeSession(token) {
      sessions.delete(token);
      _maybeFire();
    },
    allIdle() { return _checkAllIdle(); },
    idleCount() {
      let n = 0;
      for (const s of sessions.values()) if (s.idle) n++;
      return n;
    },
    activeCount() {
      let n = 0;
      for (const s of sessions.values()) if (!s.idle) n++;
      return n;
    },
    snapshot() {
      const out = {};
      for (const [tok, s] of sessions) out[tok] = { idle: s.idle, since: s.since };
      return out;
    },
  };
}

module.exports = { createIdleTracker };
