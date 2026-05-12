"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAll, missingRequired } = require("./deps_check.js");

function fakeSpawn(map) {
  return (bin, _args, _opts) => {
    const result = map[bin];
    if (result === undefined) return { status: 1, stderr: "not found" };
    if (typeof result === "string") return { status: 0, stdout: result };
    return result;
  };
}

test("checkAll: alle ok wenn jeder bin returnt", () => {
  const spawnSync = fakeSpawn({
    "claude": "2.1.138 (Claude Code)",
    "claude.cmd": "2.1.138",
    "node": "v20.0.0",
    "flutter": "Flutter 3.41.9",
    "flutter.bat": "Flutter 3.41.9",
    "adb": "Android Debug Bridge v1.0.41",
    "adb.exe": "Android Debug Bridge v1.0.41",
  });
  const r = checkAll({ spawnSync });
  assert.equal(r.claude.ok, true);
  assert.equal(r.node.ok, true);
  assert.equal(r.flutter.ok, true);
});

test("checkAll: fehlende deps → ok=false + error", () => {
  const spawnSync = fakeSpawn({ "node": "v20.0.0" });
  const r = checkAll({ spawnSync });
  assert.equal(r.node.ok, true);
  assert.equal(r.claude.ok, false);
  assert.match(r.claude.error, /nicht im PATH/);
});

test("missingRequired liefert nur die required ohne ok=true", () => {
  const r = checkAll({ spawnSync: fakeSpawn({}) });
  const miss = missingRequired(r);
  const names = miss.map(m => m.name);
  assert.ok(names.includes("claude"));
  assert.ok(names.includes("node"));
  assert.ok(!names.includes("ngrok"));
});

test("install-info ist gesetzt für claude (npm) + flutter (url)", () => {
  const r = checkAll({ spawnSync: fakeSpawn({}) });
  assert.equal(r.claude.install.npm, "@anthropic-ai/claude-code");
  assert.match(r.flutter.install.url, /flutter\.dev/);
});
