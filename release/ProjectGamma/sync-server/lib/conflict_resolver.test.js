"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveConflict, detectConflict, lastWriteWins } = require("./conflict_resolver");

function baseProject(extra = {}) {
  return {
    id: "p1",
    title: "alt",
    tasks: [{ id: "t1", title: "task-alt" }],
    conflicts: [
      {
        id: "c1", field: "title",
        localValue: "desktop-titel", remoteValue: "mobile-titel",
        localDevice: "desktop", remoteDevice: "mobile",
        status: "pending", detectedAt: "2026-05-12T09:00:00Z",
        localTs: "2026-05-12T09:00:00Z", remoteTs: "2026-05-12T10:00:00Z",
        target: { type: "project" },
      },
    ],
    ...extra,
  };
}

test("resolveConflict choice=local übernimmt lokalen wert", () => {
  const { project, applied } = resolveConflict(baseProject(), { conflictId: "c1", choice: "local" });
  assert.equal(project.title, "desktop-titel");
  assert.equal(project.conflicts[0].status, "resolved");
  assert.equal(applied.choice, "local");
});

test("resolveConflict choice=remote übernimmt remote-wert", () => {
  const { project } = resolveConflict(baseProject(), { conflictId: "c1", choice: "remote" });
  assert.equal(project.title, "mobile-titel");
});

test("resolveConflict choice=newest nutzt last-write-wins (remote neuer)", () => {
  const { applied } = resolveConflict(baseProject(), { conflictId: "c1", choice: "newest" });
  assert.equal(applied.choice, "remote");
});

test("resolveConflict auf task-target patcht den task", () => {
  const p = baseProject();
  p.conflicts[0].field = "title";
  p.conflicts[0].target = { type: "task", id: "t1" };
  p.conflicts[0].localValue = "t-desktop"; p.conflicts[0].remoteValue = "t-mobile";
  const { project } = resolveConflict(p, { conflictId: "c1", choice: "local" });
  assert.equal(project.tasks[0].title, "t-desktop");
});

test("resolveConflict wirft bei unbekannter conflictId", () => {
  assert.throws(() => resolveConflict(baseProject(), { conflictId: "xxx", choice: "local" }), /nicht gefunden/);
});

test("resolveConflict wirft bei ungültigem choice", () => {
  assert.throws(() => resolveConflict(baseProject(), { conflictId: "c1", choice: "foo" }), /local\|remote\|newest/);
});

test("resolveConflict ist idempotent-sicher (zweiter call wirft)", () => {
  const { project } = resolveConflict(baseProject(), { conflictId: "c1", choice: "local" });
  assert.throws(() => resolveConflict(project, { conflictId: "c1", choice: "local" }), /bereits aufgelöst/);
});

test("detectConflict liefert null bei gleichem wert", () => {
  assert.equal(detectConflict({ field: "title", localValue: "x", remoteValue: "x" }), null);
});

test("detectConflict erzeugt pending-eintrag bei diff", () => {
  const c = detectConflict({ field: "title", localValue: "a", remoteValue: "b" });
  assert.equal(c.status, "pending");
  assert.equal(c.field, "title");
});

test("lastWriteWins nimmt remote bei neuerem ts", () => {
  assert.equal(lastWriteWins({ localTs: "2026-01-01T00:00:00Z", remoteTs: "2026-02-01T00:00:00Z" }), "remote");
});
