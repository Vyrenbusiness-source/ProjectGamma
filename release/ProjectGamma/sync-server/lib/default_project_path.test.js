"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { resolveDefaultProjectPath } = require("./default_project_path");

test("resolveDefaultProjectPath: nutzt parent von serverDir wenn existiert", () => {
  // sync-server-dir → parent ist ProjectGamma-root
  const serverDir = path.join(__dirname, "..");
  const expected = path.resolve(serverDir, "..");
  assert.strictEqual(resolveDefaultProjectPath(serverDir), expected);
});

test("resolveDefaultProjectPath: gibt null bei nicht existierendem parent", () => {
  const fake = path.join(os.tmpdir(), "definitiv_nicht_da_xyz_" + Date.now(), "child");
  assert.strictEqual(resolveDefaultProjectPath(fake), null);
});

test("resolveDefaultProjectPath: gibt null bei undefined input", () => {
  assert.strictEqual(resolveDefaultProjectPath(undefined), null);
});

test("resolveDefaultProjectPath: nur sichere pfade werden akzeptiert", () => {
  // tmp-dir mit safe-path-konformem namen anlegen, dann unsicheren namen testen
  const safe = fs.mkdtempSync(path.join(os.tmpdir(), "pg_safe_"));
  const child = path.join(safe, "child");
  fs.mkdirSync(child);
  const result = resolveDefaultProjectPath(child);
  // safe-pfad muss erkannt werden (existiert + zeichensatz ok)
  assert.strictEqual(result, path.resolve(safe));
  fs.rmSync(safe, { recursive: true, force: true });
});
