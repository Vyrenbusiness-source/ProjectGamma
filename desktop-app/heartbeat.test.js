'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { computeBackoff, createHeartbeatMonitor } = require('./heartbeat');

test('computeBackoff: attempt 1 in [base*(1-jitter), base*(1+jitter)]', () => {
  for (let i = 0; i < 50; i++) {
    const d = computeBackoff(1, { base: 1000, factor: 1.6, max: 30000, jitter: 0.2 });
    assert.ok(d >= 800 && d <= 1200, 'attempt 1 in jitter window, got ' + d);
  }
});

test('computeBackoff: attempt 5 = base*factor^4, jitter=0', () => {
  const d = computeBackoff(5, { base: 1000, factor: 1.6, max: 30000, jitter: 0, rng: () => 0.5 });
  assert.strictEqual(d, Math.round(1000 * Math.pow(1.6, 4)));
});

test('computeBackoff: hartes cap = max', () => {
  const d = computeBackoff(100, { base: 1000, factor: 2, max: 30000, jitter: 0, rng: () => 0.5 });
  assert.strictEqual(d, 30000);
});

test('computeBackoff: cap auch mit jitter eingehalten', () => {
  for (let i = 0; i < 50; i++) {
    const d = computeBackoff(100, { base: 1000, factor: 2, max: 30000, jitter: 0.5 });
    assert.ok(d <= 30000, 'cap überschritten: ' + d);
    assert.ok(d >= 0, 'negativ: ' + d);
  }
});

test('computeBackoff: attempt<=0 → base (geclamped)', () => {
  const d = computeBackoff(0, { base: 1000, jitter: 0, rng: () => 0.5 });
  assert.strictEqual(d, 1000);
  const d2 = computeBackoff(-3, { base: 1000, jitter: 0, rng: () => 0.5 });
  assert.strictEqual(d2, 1000);
});

test('heartbeatMonitor: ping wird im intervall ausgelöst', () => {
  const pings = [];
  let now = 0;
  const timers = [];
  const mon = createHeartbeatMonitor({
    pingInterval: 1000,
    pongTimeout: 500,
    onPing: () => pings.push(now),
    onTimeout: () => {},
    setTimer: (fn, ms) => { const t = { fn, due: now + ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    now: () => now,
  });
  mon.start();
  for (let step = 0; step < 4; step++) {
    now += 1000;
    const due = timers.filter(t => t.due <= now);
    due.forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); });
    mon.notePong();
  }
  assert.ok(pings.length >= 3, 'mindestens 3 pings nach 4s, got ' + pings.length);
});

test('heartbeatMonitor: ohne PONG → onTimeout', () => {
  let timedOut = false;
  let now = 0;
  const timers = [];
  const mon = createHeartbeatMonitor({
    pingInterval: 1000,
    pongTimeout: 500,
    onPing: () => {},
    onTimeout: () => { timedOut = true; },
    setTimer: (fn, ms) => { const t = { fn, due: now + ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    now: () => now,
  });
  mon.start();
  now = 1000;
  timers.filter(t => t.due <= now).forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); });
  now = 1600;
  timers.filter(t => t.due <= now).forEach(t => { timers.splice(timers.indexOf(t), 1); t.fn(); });
  assert.strictEqual(timedOut, true);
});

test('heartbeatMonitor: stop löscht alle timer', () => {
  const timers = [];
  let now = 0;
  const mon = createHeartbeatMonitor({
    pingInterval: 1000,
    pongTimeout: 500,
    onPing: () => {},
    onTimeout: () => {},
    setTimer: (fn, ms) => { const t = { fn, due: now + ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    now: () => now,
  });
  mon.start();
  assert.ok(timers.length >= 1);
  mon.stop();
  assert.strictEqual(timers.length, 0);
});
