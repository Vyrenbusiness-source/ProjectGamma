const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./conflict_view_helpers");

const c = (over = {}) => ({
  id: "c1",
  field: "title",
  localValue: "A",
  remoteValue: "B",
  localDevice: "desktop",
  remoteDevice: "mobile",
  detectedAt: "2026-05-10T12:00:00.000Z",
  status: "pending",
  ...over,
});

test("selectPending: nur pending, älteste zuerst", () => {
  const project = {
    conflicts: [
      c({ id: "c2", detectedAt: "2026-05-10T12:05:00.000Z" }),
      c({ id: "c1", detectedAt: "2026-05-10T12:01:00.000Z" }),
      c({ id: "c3", status: "resolved" }),
    ],
  };
  assert.deepEqual(
    H.selectPending(project).map((x) => x.id),
    ["c1", "c2"],
  );
});

test("selectPending: null/missing project → []", () => {
  assert.deepEqual(H.selectPending(null), []);
  assert.deepEqual(H.selectPending({}), []);
});

test("countPending zählt nur pending", () => {
  assert.equal(
    H.countPending({ conflicts: [c(), c({ id: "x", status: "resolved" })] }),
    1,
  );
});

test("formatConflictLabel zeigt feld + geräte", () => {
  assert.equal(H.formatConflictLabel(c()), "title: desktop ↔ mobile");
});

test("previewFor liefert local/remote-wert", () => {
  assert.equal(H.previewFor(c(), "local"), "A");
  assert.equal(H.previewFor(c(), "remote"), "B");
});

test("buildResolvePayload serialisiert korrekt", () => {
  assert.deepEqual(H.buildResolvePayload("c1", "local"), {
    conflictId: "c1",
    choice: "local",
  });
});

test("buildResolvePayload lehnt leere id ab", () => {
  assert.throws(() => H.buildResolvePayload("", "local"));
});

test("buildResolvePayload lehnt unbekannte choice ab", () => {
  assert.throws(() => H.buildResolvePayload("c1", "merge"));
});
