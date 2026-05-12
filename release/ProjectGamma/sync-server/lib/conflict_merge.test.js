"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mergePatchWithDetection } = require("./conflict_merge");

function project() {
  return {
    id: "p1",
    title: "alt",
    summary: "s-alt",
    tasks: [{ id: "t1", title: "task-alt" }],
    conflicts: [],
  };
}

test("merge übernimmt feld, das lokal seit base nicht geändert wurde", () => {
  const { project: out, applied, conflicts } = mergePatchWithDetection(project(), {
    patch: { title: "neu" },
    baseValues: { title: "alt" },
    remoteDevice: "mobile",
  });
  assert.equal(out.title, "neu");
  assert.deepEqual(applied, ["title"]);
  assert.deepEqual(conflicts, []);
});

test("merge erzeugt konflikt wenn live ≠ base ≠ remote (divergenz)", () => {
  const p = project();
  p.title = "desktop-neu";
  const { project: out, applied, conflicts } = mergePatchWithDetection(p, {
    patch: { title: "mobile-neu" },
    baseValues: { title: "alt" },
    remoteDevice: "mobile",
    localDevice: "desktop",
  });
  assert.equal(out.title, "desktop-neu", "live-wert bleibt bis user löst");
  assert.deepEqual(applied, []);
  assert.equal(conflicts.length, 1);
  assert.equal(out.conflicts[0].field, "title");
  assert.equal(out.conflicts[0].localValue, "desktop-neu");
  assert.equal(out.conflicts[0].remoteValue, "mobile-neu");
  assert.equal(out.conflicts[0].status, "pending");
});

test("merge no-op wenn remote == live (keine änderung)", () => {
  const { applied, conflicts } = mergePatchWithDetection(project(), {
    patch: { title: "alt" },
    baseValues: { title: "alt" },
  });
  assert.deepEqual(applied, []);
  assert.deepEqual(conflicts, []);
});

test("merge ohne baseValue legt feld neu an", () => {
  const { project: out, applied } = mergePatchWithDetection(project(), {
    patch: { tagline: "x" },
    baseValues: {},
  });
  assert.equal(out.tagline, "x");
  assert.deepEqual(applied, ["tagline"]);
});

test("merge target=task patcht den richtigen task / erkennt task-konflikt", () => {
  const p = project();
  p.tasks[0].title = "desktop-task";
  const { project: out, conflicts } = mergePatchWithDetection(p, {
    patch: { title: "mobile-task" },
    baseValues: { title: "task-alt" },
    target: { type: "task", id: "t1" },
  });
  assert.equal(conflicts.length, 1);
  assert.equal(out.conflicts[0].target.type, "task");
  assert.equal(out.tasks[0].title, "desktop-task");
});

test("merge reicht localTs an konflikt-eintrag durch (LWW korrekt)", () => {
  const p = project();
  p.title = "desktop-neu";
  const { project: out } = mergePatchWithDetection(p, {
    patch: { title: "mobile-neu" },
    baseValues: { title: "alt" },
    localTs: "2026-05-12T08:00:00Z",
    remoteTs: "2026-05-12T10:00:00Z",
  });
  assert.equal(out.conflicts[0].localTs, "2026-05-12T08:00:00Z");
  assert.equal(out.conflicts[0].remoteTs, "2026-05-12T10:00:00Z");
});

test("merge wirft bei unbekanntem task-target", () => {
  assert.throws(() =>
    mergePatchWithDetection(project(), {
      patch: { title: "x" },
      baseValues: { title: "y" },
      target: { type: "task", id: "ghost" },
    }), /nicht gefunden/);
});
