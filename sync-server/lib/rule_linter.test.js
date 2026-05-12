// node:test-Suite für rule_linter (pure-JS, keine deps).
// Prüft die mechanischen Vor-Run-Checks, die ein Cloud-Code-Lauf
// nicht selbst erkennen kann (state-konsistenz, blockierende queue).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { lintBeforeRun } = require("./rule_linter.js");

function baseProject(extra = {}) {
  return {
    id: "p1",
    name: "P",
    path: "C:/work/p",
    rules: [{ text: "snake_case für dateien", active: true }],
    ruleDiffs: [],
    conflicts: [],
    ...extra,
  };
}

test("ok bei sauberem projekt", () => {
  const r = lintBeforeRun(baseProject());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test("fehler wenn project null/undefined", () => {
  const r = lintBeforeRun(null);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /projekt/i.test(e)));
});

test("fehler wenn kein project.path gesetzt", () => {
  const r = lintBeforeRun(baseProject({ path: "" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /path/i.test(e)));
});

test("warnung (nicht error) bei pending rule_diffs", () => {
  // Auto-pump darf nicht dauerhaft blockieren, wenn pending diffs offen sind —
  // sie werden im UI per checkmark bestätigt, nicht via cc-run.
  const r = lintBeforeRun(baseProject({
    ruleDiffs: [{ id: "d1", status: "pending", text: "x" }],
  }));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => /pending.*diff/i.test(w)));
});

test("ok bei resolved rule_diffs", () => {
  const r = lintBeforeRun(baseProject({
    ruleDiffs: [{ id: "d1", status: "approved", text: "x" }],
  }));
  assert.equal(r.ok, true);
});

test("fehler bei offenen konflikten", () => {
  const r = lintBeforeRun(baseProject({
    conflicts: [{ id: "c1", status: "pending" }],
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /konflikt/i.test(e)));
});

test("ok bei nur resolved konflikten", () => {
  const r = lintBeforeRun(baseProject({
    conflicts: [{ id: "c1", status: "resolved" }],
  }));
  assert.equal(r.ok, true);
});

test("warnung bei duplikat-regel-text", () => {
  const r = lintBeforeRun(baseProject({
    rules: [
      { text: "snake_case", active: true },
      { text: "snake_case", active: true },
    ],
  }));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => /duplikat/i.test(w)));
});

test("warnung bei leerem regel-text", () => {
  const r = lintBeforeRun(baseProject({
    rules: [{ text: "", active: true }, { text: "  ", active: true }],
  }));
  assert.ok(r.warnings.some(w => /leer/i.test(w)));
});

test("warnung wenn keine aktiven regeln", () => {
  const r = lintBeforeRun(baseProject({
    rules: [{ text: "x", active: false }],
  }));
  assert.ok(r.warnings.some(w => /aktiv/i.test(w)));
});

test("formatReport liefert nicht-leeren string bei fehlern", () => {
  const { formatReport } = require("./rule_linter.js");
  const r = lintBeforeRun(null);
  const s = formatReport(r);
  assert.ok(typeof s === "string" && s.length > 0);
});
