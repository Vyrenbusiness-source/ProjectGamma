"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { detectCheck, runBuildGate } = require("./build_gate.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pg-bg-"));
}

test("detectCheck: leer wenn pfad nicht existiert", () => {
  assert.equal(detectCheck("/does/not/exist"), null);
});

test("detectCheck: erkennt flutter (pubspec.yaml)", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
  const c = detectCheck(dir);
  assert.equal(c && c.name, "flutter");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("detectCheck: erkennt node nur wenn package.json scripts.test/check hat", () => {
  const dir = tempDir();
  // ohne scripts → nicht erkannt
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
  assert.equal(detectCheck(dir), null);
  // mit scripts.test → erkannt
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "x", scripts: { test: "node --test" } }));
  const c = detectCheck(dir);
  assert.equal(c && c.name, "node");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("detectCheck: flutter gewinnt gegenüber node, wenn beides vorhanden", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "pubspec.yaml"), "name: x\n");
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }));
  const c = detectCheck(dir);
  assert.equal(c && c.name, "flutter");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("runBuildGate: skipped wenn keine tech detected", async () => {
  const dir = tempDir();
  const r = await runBuildGate({ projectPath: dir });
  assert.equal(r.skipped, true);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "none");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("runBuildGate: customCmd success", async () => {
  const dir = tempDir();
  // node --version sollte überall klappen und exit 0 geben
  const r = await runBuildGate({
    projectPath: dir, customCmd: "node", customArgs: ["--version"],
  });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "custom");
  assert.match(r.output, /v\d+\.\d+/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("runBuildGate: customCmd fail (exit nonzero) → ok:false", async () => {
  const dir = tempDir();
  const r = await runBuildGate({
    projectPath: dir, customCmd: "node",
    customArgs: ["-e", "process.exit(2)"],
  });
  assert.equal(r.ok, false);
  assert.equal(r.exitCode, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("runBuildGate: customCmd unbekannt → ok:false + commandMissing", async () => {
  const dir = tempDir();
  const r = await runBuildGate({
    projectPath: dir, customCmd: "definitely-not-a-real-binary-9999",
    customArgs: [],
  });
  assert.equal(r.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("runBuildGate: output wird auf 8kB capped", async () => {
  const dir = tempDir();
  // 20kB output erzwingen
  const r = await runBuildGate({
    projectPath: dir, customCmd: "node",
    customArgs: ["-e", "console.log('x'.repeat(20000))"],
  });
  assert.ok(r.output.length <= 8000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("runBuildGate: onProgress callback wird aufgerufen", async () => {
  const dir = tempDir();
  let progressChunks = 0;
  await runBuildGate({
    projectPath: dir, customCmd: "node", customArgs: ["--version"],
    onProgress: () => { progressChunks++; },
  });
  assert.ok(progressChunks >= 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
