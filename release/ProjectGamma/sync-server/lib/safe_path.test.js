"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isSafeProjectPath, assertSafeProjectPath } = require("./safe_path");

test("akzeptiert normale Windows-Pfade", () => {
  assert.equal(isSafeProjectPath("C:\\Users\\Gexanx\\Desktop\\ProjectGamma"), true);
  assert.equal(isSafeProjectPath("/home/user/projekt"), true);
  assert.equal(isSafeProjectPath("D:\\Mein Projekt\\sub"), true);
});

test("lehnt shell-metazeichen ab (Code-Execution-Vektor)", () => {
  for (const evil of [
    "C:\\foo & calc.exe",
    "C:\\foo | rm -rf /",
    "C:\\foo;whoami",
    "C:\\foo>out.txt",
    "C:\\foo`id`",
    "C:\\foo$(id)",
    "C:\\foo\"x",
    "C:\\foo'x",
    "C:\\foo\nrm",
  ]) {
    assert.equal(isSafeProjectPath(evil), false, `should reject: ${evil}`);
  }
});

test("lehnt nicht-strings, leer, zu lang ab", () => {
  assert.equal(isSafeProjectPath(undefined), false);
  assert.equal(isSafeProjectPath(null), false);
  assert.equal(isSafeProjectPath(""), false);
  assert.equal(isSafeProjectPath("a".repeat(300)), false);
});

test("assertSafeProjectPath wirft mit status 400", () => {
  assert.throws(() => assertSafeProjectPath("C:\\foo & evil"), (e) => e.status === 400);
  assert.doesNotThrow(() => assertSafeProjectPath("C:\\ok\\path"));
});

test("abgeleitete Pfade aus unsicherem project.path bleiben unsicher (rebuildMobileApp)", () => {
  // path.join trägt shell-metazeichen weiter — die Defense-in-depth-Checks vor
  // spawn (mobileDir, flutterBin, apkPath) müssen daher unabhängig greifen.
  const path = require("node:path");
  const evil = "C:\\proj & calc.exe";
  assert.equal(isSafeProjectPath(path.join(evil, "mobile-app")), false);
  assert.equal(isSafeProjectPath(path.join(evil, "Flutter", "flutter", "bin", "flutter.bat")), false);
  assert.equal(isSafeProjectPath(path.join(evil, "mobile-app", "build", "app", "outputs", "flutter-apk", "app-debug.apk")), false);
});
