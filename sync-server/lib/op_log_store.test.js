"use strict";
/**
 * Tests fuer op_log_store: sqlite-persistenz fuer das delta-op-log.
 * Regeln: node:test, snake_case, persistenz ausschliesslich via dieses modul.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpLogStore } = require("./op_log_store");

function freshStore() {
  return createOpLogStore({ filename: ":memory:" });
}

test("appendOp speichert op und vergibt monotone seq pro project", () => {
  const s = freshStore();
  const a = s.appendOp("p1", { opId: "o1", lamport: 1, deviceId: "d1", type: "ADD_TASK", payload: { id: "t1" }, ts: 1000 });
  const b = s.appendOp("p1", { opId: "o2", lamport: 2, deviceId: "d1", type: "ADD_TASK", payload: { id: "t2" }, ts: 1001 });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  s.close();
});

test("seq ist pro project unabhaengig", () => {
  const s = freshStore();
  const a = s.appendOp("p1", { opId: "o1", lamport: 1, deviceId: "d1", type: "X", payload: {}, ts: 1 });
  const b = s.appendOp("p2", { opId: "o2", lamport: 1, deviceId: "d1", type: "X", payload: {}, ts: 2 });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 1);
  s.close();
});

test("appendOp ist idempotent bei gleicher opId (gleiches project)", () => {
  const s = freshStore();
  const a = s.appendOp("p1", { opId: "o1", lamport: 1, deviceId: "d1", type: "X", payload: {}, ts: 1 });
  const again = s.appendOp("p1", { opId: "o1", lamport: 1, deviceId: "d1", type: "X", payload: {}, ts: 2 });
  assert.equal(again.seq, a.seq);
  assert.equal(s.opsSince("p1", 0).length, 1);
  s.close();
});

test("opsSince liefert nur ops mit seq > cursor in seq-reihenfolge", () => {
  const s = freshStore();
  s.appendOp("p1", { opId: "o1", lamport: 1, deviceId: "d1", type: "X", payload: { n: 1 }, ts: 1 });
  s.appendOp("p1", { opId: "o2", lamport: 2, deviceId: "d1", type: "X", payload: { n: 2 }, ts: 2 });
  s.appendOp("p1", { opId: "o3", lamport: 3, deviceId: "d1", type: "X", payload: { n: 3 }, ts: 3 });
  const tail = s.opsSince("p1", 1);
  assert.equal(tail.length, 2);
  assert.equal(tail[0].opId, "o2");
  assert.equal(tail[1].opId, "o3");
  assert.deepEqual(tail[0].payload, { n: 2 });
  s.close();
});

test("head liefert hoechste seq+lamport pro project (0/0 wenn leer)", () => {
  const s = freshStore();
  assert.deepEqual(s.head("p1"), { seq: 0, lamport: 0 });
  s.appendOp("p1", { opId: "o1", lamport: 5, deviceId: "d1", type: "X", payload: {}, ts: 1 });
  assert.deepEqual(s.head("p1"), { seq: 1, lamport: 5 });
  s.close();
});

test("compact loescht ops mit seq <= safeSeq und gibt anzahl zurueck", () => {
  const s = freshStore();
  s.appendOp("p1", { opId: "o1", lamport: 1, deviceId: "d1", type: "X", payload: {}, ts: 1 });
  s.appendOp("p1", { opId: "o2", lamport: 2, deviceId: "d1", type: "X", payload: {}, ts: 2 });
  s.appendOp("p1", { opId: "o3", lamport: 3, deviceId: "d1", type: "X", payload: {}, ts: 3 });
  const removed = s.compact("p1", 2);
  assert.equal(removed, 2);
  const remaining = s.opsSince("p1", 0);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].opId, "o3");
  s.close();
});

test("persistiert ueber close/reopen hinweg (echte sqlite-datei)", () => {
  const path = require("node:path");
  const os = require("node:os");
  const fs = require("node:fs");
  const file = path.join(os.tmpdir(), `op_log_store_test_${Date.now()}_${Math.random().toString(36).slice(2,7)}.db`);
  try {
    const a = createOpLogStore({ filename: file });
    a.appendOp("p1", { opId: "o1", lamport: 1, deviceId: "d1", type: "X", payload: { v: 42 }, ts: 1 });
    a.close();
    const b = createOpLogStore({ filename: file });
    const tail = b.opsSince("p1", 0);
    assert.equal(tail.length, 1);
    assert.equal(tail[0].payload.v, 42);
    assert.deepEqual(b.head("p1"), { seq: 1, lamport: 1 });
    b.close();
  } finally {
    try { fs.unlinkSync(file); } catch (_) {}
  }
});

test("appendOp wirft bei fehlenden pflichtfeldern", () => {
  const s = freshStore();
  assert.throws(() => s.appendOp("p1", { opId: "o", lamport: 1, type: "X", payload: {}, ts: 1 }), /deviceId/);
  assert.throws(() => s.appendOp("p1", { opId: "o", lamport: 1, deviceId: "d", payload: {}, ts: 1 }), /type/);
  assert.throws(() => s.appendOp("", { opId: "o", lamport: 1, deviceId: "d", type: "X", payload: {}, ts: 1 }), /projectId/);
  s.close();
});
