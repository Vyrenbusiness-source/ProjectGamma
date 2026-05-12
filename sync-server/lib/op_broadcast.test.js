'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildOpAppendFrame,
  buildOpBatchFrame,
  selectRecipients,
} = require('./op_broadcast');

test('buildOpAppendFrame liefert kanonisches OP_APPEND-frame', () => {
  const op = { opId: 'op_a', seq: 7, lamport: 12, deviceId: 'd1', type: 'ADD_TASK', payload: { id: 't1' }, ts: 100 };
  const frame = buildOpAppendFrame('proj1', op);
  assert.strictEqual(frame.type, 'OP_APPEND');
  assert.strictEqual(frame.projectId, 'proj1');
  assert.deepStrictEqual(frame.op, op);
});

test('buildOpAppendFrame wirft bei fehlender opId/seq', () => {
  assert.throws(() => buildOpAppendFrame('p1', { seq: 1 }), /opId/);
  assert.throws(() => buildOpAppendFrame('p1', { opId: 'x' }), /seq/);
});

test('buildOpBatchFrame liefert OP_BATCH mit ops sortiert nach seq', () => {
  const ops = [
    { opId: 'a', seq: 3, type: 'X', deviceId: 'd1' },
    { opId: 'b', seq: 1, type: 'Y', deviceId: 'd1' },
    { opId: 'c', seq: 2, type: 'Z', deviceId: 'd1' },
  ];
  const frame = buildOpBatchFrame('p1', ops);
  assert.strictEqual(frame.type, 'OP_BATCH');
  assert.strictEqual(frame.projectId, 'p1');
  assert.deepStrictEqual(frame.ops.map(o => o.seq), [1, 2, 3]);
});

test('buildOpBatchFrame mit leerem array ist erlaubt (no-op signal)', () => {
  const frame = buildOpBatchFrame('p1', []);
  assert.deepStrictEqual(frame.ops, []);
});

test('selectRecipients filtert clients nach projectId', () => {
  const clients = [
    { id: 'c1', projectId: 'p1', readyState: 1 },
    { id: 'c2', projectId: 'p2', readyState: 1 },
    { id: 'c3', projectId: 'p1', readyState: 1 },
  ];
  const got = selectRecipients(clients, { projectId: 'p1' });
  assert.deepStrictEqual(got.map(c => c.id), ['c1', 'c3']);
});

test('selectRecipients schliesst origin-device aus, wenn excludeDeviceId gesetzt', () => {
  const clients = [
    { id: 'c1', projectId: 'p1', deviceId: 'd1', readyState: 1 },
    { id: 'c2', projectId: 'p1', deviceId: 'd2', readyState: 1 },
  ];
  const got = selectRecipients(clients, { projectId: 'p1', excludeDeviceId: 'd1' });
  assert.deepStrictEqual(got.map(c => c.id), ['c2']);
});

test('selectRecipients filtert nicht-offene sockets (readyState!=1) raus', () => {
  const clients = [
    { id: 'c1', projectId: 'p1', readyState: 1 },
    { id: 'c2', projectId: 'p1', readyState: 0 },
    { id: 'c3', projectId: 'p1', readyState: 3 },
  ];
  const got = selectRecipients(clients, { projectId: 'p1' });
  assert.deepStrictEqual(got.map(c => c.id), ['c1']);
});

test('selectRecipients leerer input -> leere liste', () => {
  assert.deepStrictEqual(selectRecipients([], { projectId: 'p1' }), []);
  assert.deepStrictEqual(selectRecipients(null, { projectId: 'p1' }), []);
});
