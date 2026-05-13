"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runSetupCheck } = require("./setup_check.js");

test("runSetupCheck liefert struktur mit ok/blockers/checks", async () => {
  const result = await runSetupCheck({ baseDir: __dirname });
  assert.ok(typeof result.ok === "boolean");
  assert.ok(typeof result.blockers === "number");
  assert.ok(Array.isArray(result.checks));
  assert.equal(result.checks.length, 5); // node, claude-cli, git, flutter, adb
});

test("jeder check hat name + severity + available", async () => {
  const result = await runSetupCheck({ baseDir: __dirname });
  for (const c of result.checks) {
    assert.ok(typeof c.name === "string", "missing name");
    assert.ok(c.severity === "critical" || c.severity === "optional", "bad severity: " + c.severity);
    assert.ok(typeof c.available === "boolean", "available not bool");
  }
});

test("node-check ist always-pass im test-context (node läuft ja)", async () => {
  const result = await runSetupCheck({ baseDir: __dirname });
  const node = result.checks.find(c => c.name === "node");
  assert.ok(node);
  assert.equal(node.available, true);
  assert.match(node.version, /^v\d+/);
});

test("ok-flag true wenn alle critical-checks available sind", async () => {
  const result = await runSetupCheck({ baseDir: __dirname });
  const criticalMissing = result.checks.filter(c => c.severity === "critical" && !c.available);
  assert.equal(result.blockers, criticalMissing.length);
  assert.equal(result.ok, criticalMissing.length === 0);
});

test("missing-deps haben hint-text", async () => {
  const result = await runSetupCheck({ baseDir: __dirname });
  for (const c of result.checks) {
    if (!c.available) {
      assert.ok(typeof c.hint === "string" && c.hint.length > 10, c.name + " sollte hint haben");
    }
  }
});
