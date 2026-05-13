"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { shouldRunRuntime, detectRuntime, runRuntimeTest } = require("./runtime_test.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pg-rt-"));
}

test("shouldRunRuntime: leere liste → false", () => {
  assert.equal(shouldRunRuntime([]), false);
  assert.equal(shouldRunRuntime(null), false);
});

test("shouldRunRuntime: nur doc-änderung → false", () => {
  assert.equal(shouldRunRuntime(["README.md", "docs/foo.txt"]), false);
});

test("shouldRunRuntime: tests-only → false", () => {
  assert.equal(shouldRunRuntime(["test/foo.test.js", "lib/foo.test.js"]), false);
});

test("shouldRunRuntime: server.js → true", () => {
  assert.equal(shouldRunRuntime(["server.js"]), true);
});

test("shouldRunRuntime: jsx UI → true", () => {
  assert.equal(shouldRunRuntime(["src/app.jsx"]), true);
});

test("shouldRunRuntime: mixed (test + production) → true", () => {
  assert.equal(shouldRunRuntime(["test/x.test.js", "server.js"]), true);
});

test("detectRuntime: leer wenn nichts", () => {
  const dir = tempDir();
  assert.equal(detectRuntime(dir), null);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test("detectRuntime: erkennt node-server via package.json scripts.start", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ scripts: { start: "node server.js" } }));
  const r = detectRuntime(dir);
  assert.equal(r && r.kind, "node-server");
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test("detectRuntime: erkennt node-server via server.js", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "server.js"), "// hi");
  const r = detectRuntime(dir);
  assert.equal(r && r.kind, "node-server");
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test("detectRuntime: erkennt static-frontend via index.html", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html></html>");
  const r = detectRuntime(dir);
  assert.equal(r && r.kind, "static-frontend");
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test("runRuntimeTest: skipped wenn keine runtime-relevante files", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "server.js"), "// hi");
  const r = await runRuntimeTest({ projectPath: dir, filesChanged: ["README.md"] });
  assert.equal(r.skipped, true);
  assert.equal(r.ok, true);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test("runRuntimeTest: node-server der bootet + auf /health antwortet → ok", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "server.js"),
    `const http = require("http");
     const PORT = Number(process.env.PORT) || 3000;
     http.createServer((req, res) => {
       if (req.url === "/health") { res.writeHead(200, {"content-type": "application/json"}); res.end(JSON.stringify({ok:true})); }
       else { res.writeHead(404); res.end(); }
     }).listen(PORT, "127.0.0.1");`
  );
  const r = await runRuntimeTest({ projectPath: dir, filesChanged: ["server.js"] });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "node-server");
  assert.match(r.output, /health ok/);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

test("runRuntimeTest: node-server der crasht → ok:false", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "server.js"),
    `throw new Error("boom on startup");`);
  const r = await runRuntimeTest({ projectPath: dir, filesChanged: ["server.js"] });
  assert.equal(r.ok, false);
  assert.match(r.output, /boom/);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});
