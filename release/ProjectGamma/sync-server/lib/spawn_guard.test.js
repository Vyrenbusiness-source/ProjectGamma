"use strict";

// Regressions-Test: jeder spawn(...) mit shell:true in server.js muss
// unmittelbar (≤ 12 Zeilen davor) von einem assertSafeProjectPath-Aufruf
// abgesichert sein. Defense-in-depth gegen veraltete state.json-Einträge,
// die vor PATCH_PROJECT-Validierung persistiert wurden.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("alle spawn(shell:true) sind durch assertSafeProjectPath abgesichert", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const lines = src.split(/\r?\n/);
  const spawnIdx = [];
  lines.forEach((line, i) => {
    const stripped = line.replace(/\/\/.*$/, "");
    if (/(?:^|[^/\w])spawn\s*\(/.test(stripped)) spawnIdx.push(i);
  });
  assert.ok(spawnIdx.length >= 3, "erwartet mindestens 3 spawn-Aufrufe");

  for (const i of spawnIdx) {
    const block = lines.slice(i, Math.min(i + 8, lines.length)).join("\n");
    if (!/shell\s*:\s*true/.test(block)) continue;
    // Skip statische spawn-Aufrufe (kein cwd, keine Variablen-Args).
    // Defense-in-depth-Regel betrifft nur user-derivierte cwd/args.
    if (!/\bcwd\s*:/.test(block)) continue;
    const before = lines.slice(Math.max(0, i - 12), i).join("\n");
    assert.ok(
      /assertSafeProjectPath\s*\(/.test(before),
      `spawn in Zeile ${i + 1} ohne assertSafeProjectPath in den 12 Zeilen davor`
    );
  }
});
