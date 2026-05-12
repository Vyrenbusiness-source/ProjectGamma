'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createOpLog } = require('./op_log');

test('append weist monoton steigende seq zu', () => {
  const log = createOpLog();
  const a = log.append({ deviceId: 'd1', type: 'ADD_TASK', payload: { id: 't1' } });
  const b = log.append({ deviceId: 'd1', type: 'ADD_TASK', payload: { id: 't2' } });
  assert.strictEqual(a.seq, 1);
  assert.strictEqual(b.seq, 2);
  assert.ok(b.lamport > a.lamport);
});

test('since(seq) liefert nur neuere ops', () => {
  const log = createOpLog();
  log.append({ deviceId: 'd1', type: 'A', payload: {} });
  log.append({ deviceId: 'd1', type: 'B', payload: {} });
  log.append({ deviceId: 'd1', type: 'C', payload: {} });
  const tail = log.since(1);
  assert.deepStrictEqual(tail.map(o => o.type), ['B', 'C']);
});

test('since(0) liefert alle, since(>=last) liefert leer', () => {
  const log = createOpLog();
  log.append({ deviceId: 'd1', type: 'X', payload: {} });
  assert.strictEqual(log.since(0).length, 1);
  assert.strictEqual(log.since(1).length, 0);
});

test('mergeRemote zieht lamport nach + dedupliziert per opId', () => {
  const log = createOpLog();
  const local = log.append({ deviceId: 'd1', type: 'A', payload: {} });
  const inserted = log.mergeRemote([
    { opId: 'r1', deviceId: 'd2', lamport: 50, type: 'B', payload: {} },
    { opId: 'r1', deviceId: 'd2', lamport: 50, type: 'B', payload: {} },
  ]);
  assert.strictEqual(inserted.length, 1);
  const next = log.append({ deviceId: 'd1', type: 'C', payload: {} });
  assert.ok(next.lamport > 50, 'lokal-lamport muss nach remote-merge weiterspringen');
  assert.ok(next.lamport > local.lamport);
});

test('compact entfernt ops bis safeSeq und behält rest', () => {
  const log = createOpLog();
  for (let i = 0; i < 5; i++) log.append({ deviceId: 'd1', type: 'T', payload: { i } });
  const removed = log.compact(3);
  assert.strictEqual(removed, 3);
  const rest = log.since(0);
  assert.strictEqual(rest.length, 2);
  assert.strictEqual(rest[0].seq, 4);
});

test('append validiert pflichtfelder', () => {
  const log = createOpLog();
  assert.throws(() => log.append({ type: 'X', payload: {} }), /deviceId/);
  assert.throws(() => log.append({ deviceId: 'd1', payload: {} }), /type/);
});

test('toJSON/fromJSON erhält state', () => {
  const log = createOpLog();
  log.append({ deviceId: 'd1', type: 'A', payload: { v: 1 } });
  log.append({ deviceId: 'd1', type: 'B', payload: { v: 2 } });
  const restored = createOpLog(log.toJSON());
  assert.strictEqual(restored.since(0).length, 2);
  const next = restored.append({ deviceId: 'd1', type: 'C', payload: {} });
  assert.strictEqual(next.seq, 3);
});
