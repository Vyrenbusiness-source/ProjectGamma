'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { recordAndBroadcastOp, resyncSince } = require('./op_log_wiring');

function fakeStore() {
  const ops = [];
  let seq = 0;
  return {
    ops,
    appendOp(projectId, op) {
      const dup = ops.find(o => o.projectId === projectId && o.opId === op.opId);
      if (dup) return dup;
      seq += 1;
      const persisted = { ...op, projectId, seq, lamport: op.lamport || seq, ts: op.ts || 1 };
      ops.push(persisted);
      return persisted;
    },
    opsSince(projectId, cursor) {
      return ops.filter(o => o.projectId === projectId && o.seq > cursor)
               .sort((a, b) => a.seq - b.seq);
    },
  };
}

function fakeClient(projectId, deviceId, ready = 1) {
  return { projectId, deviceId, readyState: ready, sent: [], send(msg) { this.sent.push(msg); } };
}

test('recordAndBroadcastOp persistiert + broadcastet ohne origin-device', () => {
  const store = fakeStore();
  const a = fakeClient('p1', 'devA');
  const b = fakeClient('p1', 'devB');
  const c = fakeClient('p2', 'devC');
  const res = recordAndBroadcastOp({
    store, projectId: 'p1',
    op: { opId: 'op1', type: 'ADD_TASK', deviceId: 'devA', payload: { id: 't1' } },
    originDeviceId: 'devA',
    clients: [a, b, c],
  });
  assert.strictEqual(res.op.seq, 1);
  assert.strictEqual(res.frame.type, 'OP_APPEND');
  assert.strictEqual(res.recipients.length, 1);
  assert.strictEqual(res.recipients[0].deviceId, 'devB');
  assert.strictEqual(a.sent.length, 0, 'origin bekommt nichts');
  assert.strictEqual(b.sent.length, 1);
  assert.strictEqual(c.sent.length, 0, 'fremdes projekt bekommt nichts');
});

test('recordAndBroadcastOp ist idempotent ueber gleiche opId', () => {
  const store = fakeStore();
  const b = fakeClient('p1', 'devB');
  const op = { opId: 'op-dup', type: 'X', deviceId: 'devA', payload: {} };
  const r1 = recordAndBroadcastOp({ store, projectId: 'p1', op, originDeviceId: 'devA', clients: [b] });
  const r2 = recordAndBroadcastOp({ store, projectId: 'p1', op, originDeviceId: 'devA', clients: [b] });
  assert.strictEqual(r1.op.seq, 1);
  assert.strictEqual(r2.op.seq, 1, 'dedupliziert via store');
});

test('recordAndBroadcastOp validiert pflichtfelder', () => {
  const store = fakeStore();
  assert.throws(() => recordAndBroadcastOp({ store, projectId: 'p1', op: { type: 'X', deviceId: 'd' }, clients: [] }), /opId/);
  assert.throws(() => recordAndBroadcastOp({ store, op: { opId: 'o', type: 'X', deviceId: 'd' }, clients: [] }), /projectId/);
});

test('resyncSince baut OP_BATCH und sendet an einen client', () => {
  const store = fakeStore();
  store.appendOp('p1', { opId: 'a', type: 'X', deviceId: 'd1', payload: {} });
  store.appendOp('p1', { opId: 'b', type: 'Y', deviceId: 'd1', payload: {} });
  store.appendOp('p1', { opId: 'c', type: 'Z', deviceId: 'd1', payload: {} });
  const target = fakeClient('p1', 'devX');
  const res = resyncSince({ store, projectId: 'p1', since: 1, sendTo: target });
  assert.strictEqual(res.count, 2);
  assert.strictEqual(res.frame.type, 'OP_BATCH');
  assert.strictEqual(res.frame.ops.length, 2);
  assert.strictEqual(res.frame.ops[0].seq, 2);
  assert.strictEqual(target.sent.length, 1);
  assert.strictEqual(res.delivered, true);
});

test('resyncSince ohne sendTo liefert frame ohne delivery', () => {
  const store = fakeStore();
  store.appendOp('p1', { opId: 'a', type: 'X', deviceId: 'd1', payload: {} });
  const res = resyncSince({ store, projectId: 'p1', since: 0 });
  assert.strictEqual(res.delivered, false);
  assert.strictEqual(res.count, 1);
});
