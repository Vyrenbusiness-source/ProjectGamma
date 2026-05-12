"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNotification } = require("./notify_dispatch");

const NOW = () => "2026-05-10T10:00:00.000Z";
const genId = () => "n1";

test("cc_done baut titel + body aus exitCode/suggestions", () => {
  const n = buildNotification({
    type: "cc_done", projectId: "p1", projectName: "Gamma",
    exitCode: 0, suggestionsApplied: 2,
  }, { now: NOW, genId });
  assert.equal(n.type, "cc_done");
  assert.equal(n.projectId, "p1");
  assert.match(n.title, /Gamma/);
  assert.match(n.body, /erfolgreich|fertig|abgeschlossen/i);
  assert.match(n.body, /2/);
  assert.equal(n.priority, "normal");
  assert.equal(n.id, "n1");
  assert.equal(n.createdAt, "2026-05-10T10:00:00.000Z");
});

test("cc_done mit exit!=0 wird high priority + warn-body", () => {
  const n = buildNotification({
    type: "cc_done", projectId: "p1", projectName: "Gamma", exitCode: 2,
  }, { now: NOW, genId });
  assert.equal(n.priority, "high");
  assert.match(n.body, /fehler|exit/i);
});

test("cc_error → high priority mit fehlertext", () => {
  const n = buildNotification({
    type: "cc_error", projectId: "p1", projectName: "G", error: "ENOENT",
  }, { now: NOW, genId });
  assert.equal(n.priority, "high");
  assert.match(n.body, /ENOENT/);
});

test("idea_processed mit ideaText (gekürzt) + low priority", () => {
  const long = "x".repeat(200);
  const n = buildNotification({
    type: "idea_processed", projectId: "p1", projectName: "G",
    ideaText: long, action: "task_created",
  }, { now: NOW, genId });
  assert.equal(n.priority, "low");
  assert.ok(n.body.length < 200);
  assert.match(n.body, /aufgabe|task/i);
});

test("unbekannter typ → null (kein silent-skip ohne signal)", () => {
  const n = buildNotification({ type: "what" }, { now: NOW, genId });
  assert.equal(n, null);
});
