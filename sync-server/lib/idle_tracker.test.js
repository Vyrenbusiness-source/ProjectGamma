'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createIdleTracker } = require('./idle_tracker');

test('idle_tracker: leer → allIdle()=false (kein client = nicht idle)', () => {
  const t = createIdleTracker();
  assert.strictEqual(t.allIdle(), false);
  assert.strictEqual(t.idleCount(), 0);
  assert.strictEqual(t.activeCount(), 0);
});

test('idle_tracker: setIdle markiert session, allIdle=true wenn alle idle', () => {
  const t = createIdleTracker();
  t.setIdle('tok-a', true, 1000);
  assert.strictEqual(t.allIdle(), true);
  assert.strictEqual(t.idleCount(), 1);

  t.setIdle('tok-b', false, 1000);
  assert.strictEqual(t.allIdle(), false);
  assert.strictEqual(t.activeCount(), 1);

  t.setIdle('tok-b', true, 2000);
  assert.strictEqual(t.allIdle(), true);
});

test('idle_tracker: removeSession entfernt eine session', () => {
  const t = createIdleTracker();
  t.setIdle('tok-a', true, 1000);
  t.setIdle('tok-b', false, 1000);
  t.removeSession('tok-b');
  assert.strictEqual(t.allIdle(), true);
  t.removeSession('tok-a');
  assert.strictEqual(t.allIdle(), false); // leer ≠ all-idle
});

test('idle_tracker: onAllIdle wird einmal pro übergang gefeuert', () => {
  let fired = 0;
  const t = createIdleTracker({ onAllIdle: () => { fired++; } });
  t.setIdle('a', true, 100);
  t.setIdle('b', true, 100);
  assert.strictEqual(fired, 1); // a→ alle idle (1 session), b dazu, immer noch alle idle → keine neue übergang
  t.setIdle('a', false, 200);
  assert.strictEqual(fired, 1);
  t.setIdle('a', true, 300);
  assert.strictEqual(fired, 2); // wieder all-idle übergang
});

test('idle_tracker: stale-since wird gespeichert + per session abrufbar', () => {
  const t = createIdleTracker();
  t.setIdle('a', true, 12345);
  const snap = t.snapshot();
  assert.strictEqual(snap.a.idle, true);
  assert.strictEqual(snap.a.since, 12345);
});

test('idle_tracker: setIdle ohne since-arg → idle=false, kein crash', () => {
  const t = createIdleTracker();
  t.setIdle('a', false);
  assert.strictEqual(t.idleCount(), 0);
  assert.strictEqual(t.activeCount(), 1);
});

test('idle_tracker: doppeltes setIdle(true) feuert onAllIdle nicht erneut', () => {
  let fired = 0;
  const t = createIdleTracker({ onAllIdle: () => fired++ });
  t.setIdle('a', true, 1);
  t.setIdle('a', true, 2);
  t.setIdle('a', true, 3);
  assert.strictEqual(fired, 1);
});
