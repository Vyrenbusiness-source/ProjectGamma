"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createOfflineQueue, drainAndSend } = require("./offline_queue");

test("enqueue legt pending an, neueste zuerst", () => {
  const q = createOfflineQueue();
  const a = q.enqueue("CREATE_IDEA", { text: "a" });
  const b = q.enqueue("CREATE_IDEA", { text: "b" });
  assert.equal(a.status, "pending");
  assert.deepEqual(q.list().map(i => i.id), [b.id, a.id]);
  assert.equal(q.pending().length, 2);
});

test("enqueue wirft bei leerem type", () => {
  const q = createOfflineQueue();
  assert.throws(() => q.enqueue("", {}), /type/);
});

test("markSent / markFailed / retry / drop", () => {
  const q = createOfflineQueue();
  const a = q.enqueue("X", {});
  q.markSent(a.id);
  assert.equal(q.list()[0].status, "sent");
  const b = q.enqueue("Y", {});
  q.markFailed(b.id, "boom");
  assert.equal(q.list()[0].status, "failed");
  assert.equal(q.list()[0].error, "boom");
  assert.equal(q.list()[0].retryCount, 1);
  q.retry(b.id);
  assert.equal(q.list()[0].status, "pending");
  assert.equal(q.list()[0].error, null);
  q.drop(b.id);
  assert.equal(q.list().length, 1);
});

test("drainPending liefert chronologisch (älteste zuerst)", () => {
  const q = createOfflineQueue();
  const a = q.enqueue("A", {});
  const b = q.enqueue("B", {});
  assert.deepEqual(q.drainPending().map(i => i.id), [a.id, b.id]);
});

test("toJson / fromJson round-trip", () => {
  const q = createOfflineQueue();
  const a = q.enqueue("CREATE_TASK", { title: "x" });
  q.markFailed(a.id, "net");
  const json = q.toJson();
  const restored = createOfflineQueue().fromJson(json);
  assert.equal(restored.list().length, 1);
  assert.equal(restored.list()[0].status, "failed");
  assert.equal(restored.list()[0].error, "net");
  assert.equal(restored.list()[0].type, "CREATE_TASK");
  assert.deepEqual(restored.list()[0].payload, { title: "x" });
});

test("cap behält pending bevorzugt", () => {
  const q = createOfflineQueue({ max: 2 });
  const a = q.enqueue("A", {});
  q.markSent(a.id);
  q.enqueue("B", {});
  q.enqueue("C", {});
  // sent darf rausfallen, pending bleiben
  const ids = q.list().map(i => i.type);
  assert.ok(ids.includes("B") && ids.includes("C"));
});

test("cap hält strikt max ein wenn pending.length > max", () => {
  // Regression: vorher slice(0, Math.max(max, pending.length)) → limit verletzt.
  const q = createOfflineQueue({ max: 3 });
  for (let i = 0; i < 7; i++) q.enqueue("T" + i, {});
  assert.equal(q.list().length, 3);
  assert.equal(q.pending().length, 3);
});

test("drainAndSend ruft sender für jedes pending und markiert sent bei true", async () => {
  const q = createOfflineQueue();
  q.enqueue("A", { v: 1 });
  q.enqueue("B", { v: 2 });
  const seen = [];
  await drainAndSend({
    queue: q,
    sender: (item) => { seen.push(item.type); return true; },
  });
  assert.deepEqual(seen, ["A", "B"]);
  assert.equal(q.pending().length, 0);
  assert.ok(q.list().every(i => i.status === "sent"));
});

test("drainAndSend markiert failed wenn sender false zurückgibt", async () => {
  const q = createOfflineQueue();
  const a = q.enqueue("A", {});
  await drainAndSend({ queue: q, sender: () => false });
  assert.equal(q.list()[0].status, "failed");
  assert.equal(q.list()[0].id, a.id);
});

test("drainAndSend fängt sender-exceptions als failed", async () => {
  const q = createOfflineQueue();
  q.enqueue("A", {});
  await drainAndSend({ queue: q, sender: () => { throw new Error("nope"); } });
  assert.equal(q.list()[0].status, "failed");
  assert.match(q.list()[0].error, /nope/);
});
