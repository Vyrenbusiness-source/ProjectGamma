'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { inverseMutation, UndoStack, isSwipeable } = require('./swipe_undo');

test('inverseMutation: TOGGLE_TASK ist idempotent', () => {
  const r = inverseMutation('TOGGLE_TASK', { projectId: 'p', taskId: 't1' });
  assert.deepStrictEqual(r, {
    type: 'TOGGLE_TASK',
    payload: { projectId: 'p', taskId: 't1' },
  });
});

test('inverseMutation: DISMISS_IDEA → REACTIVATE_IDEA', () => {
  const r = inverseMutation('DISMISS_IDEA', { projectId: 'p', ideaId: 'i1' });
  assert.strictEqual(r.type, 'REACTIVATE_IDEA');
  assert.deepStrictEqual(r.payload, { projectId: 'p', ideaId: 'i1' });
});

test('inverseMutation: CONVERT_IDEA → REACTIVATE_IDEA', () => {
  const r = inverseMutation('CONVERT_IDEA', { ideaId: 'x' });
  assert.strictEqual(r.type, 'REACTIVATE_IDEA');
});

test('inverseMutation: REACTIVATE_IDEA → DISMISS_IDEA', () => {
  const r = inverseMutation('REACTIVATE_IDEA', { ideaId: 'x' });
  assert.strictEqual(r.type, 'DISMISS_IDEA');
});

test('inverseMutation: unbekannter Typ → null', () => {
  assert.strictEqual(inverseMutation('FOO_BAR', {}), null);
});

test('inverseMutation: payload wird kopiert (kein shared ref)', () => {
  const src = { projectId: 'p', taskId: 't' };
  const r = inverseMutation('TOGGLE_TASK', src);
  r.payload.taskId = 'changed';
  assert.strictEqual(src.taskId, 't');
});

test('UndoStack: push + consume', () => {
  const s = new UndoStack({ ttlMs: 1000, now: () => 1000 });
  s.push({ id: 'a', mutationType: 'TOGGLE_TASK', payload: { taskId: '1' } });
  assert.strictEqual(s.size, 1);
  const popped = s.consume('a');
  assert.strictEqual(popped.id, 'a');
  assert.strictEqual(s.size, 0);
  assert.strictEqual(s.consume('a'), null);
});

test('UndoStack: active filtert abgelaufene', () => {
  let now = 0;
  const s = new UndoStack({ ttlMs: 100, now: () => now });
  s.push({ id: 'old', mutationType: 'TOGGLE_TASK', payload: {} });
  now = 50;
  s.push({ id: 'new', mutationType: 'TOGGLE_TASK', payload: {} });
  now = 200;
  const active = s.active;
  assert.strictEqual(active.length, 0);
  now = 120;
  assert.strictEqual(s.active.length, 1);
  assert.strictEqual(s.active[0].id, 'new');
});

test('UndoStack: purgeExpired entfernt nur abgelaufene', () => {
  let now = 0;
  const s = new UndoStack({ ttlMs: 100, now: () => now });
  s.push({ id: 'old', mutationType: 'TOGGLE_TASK', payload: {} });
  now = 50;
  s.push({ id: 'new', mutationType: 'TOGGLE_TASK', payload: {} });
  now = 120;
  const removed = s.purgeExpired();
  assert.strictEqual(removed, 1);
  assert.strictEqual(s.size, 1);
  assert.strictEqual(s._entries[0].id, 'new');
});

test('UndoStack: push ohne id wirft', () => {
  const s = new UndoStack();
  assert.throws(() => s.push({ mutationType: 'TOGGLE_TASK' }));
});

test('isSwipeable: ghost-pending items sind nicht swipe-bar', () => {
  assert.strictEqual(isSwipeable({ id: '1' }), true);
  assert.strictEqual(isSwipeable({ id: '1', __pending: true }), false);
  assert.strictEqual(isSwipeable(null), false);
});
