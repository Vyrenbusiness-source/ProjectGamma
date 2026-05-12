// node:test-suite für apk_release. Deckt parser + version-compare + sha256 + io.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parsePubspecVersion, compareVersions, sha256OfBuffer, readReleaseInfo,
} = require("./apk_release");

test("parsePubspecVersion liest semver+build", () => {
  const v = parsePubspecVersion("version: 1.2.3+45");
  assert.deepEqual(v, { semver: "1.2.3", build: 45, full: "1.2.3+45" });
});

test("parsePubspecVersion liefert null bei fehlender zeile", () => {
  assert.equal(parsePubspecVersion("foo: bar"), null);
});

test("compareVersions: höherer build gewinnt", () => {
  assert.equal(compareVersions("1.0.0+5", "1.0.0+3"), 1);
  assert.equal(compareVersions("1.0.0+1", "1.0.0+2"), -1);
  assert.equal(compareVersions("1.0.0+1", "1.0.0+1"), 0);
});

test("compareVersions: höherer semver schlägt build", () => {
  assert.equal(compareVersions("1.1.0+1", "1.0.99+99"), 1);
});

test("sha256OfBuffer ist stabil", () => {
  const a = sha256OfBuffer(Buffer.from("hello"));
  const b = sha256OfBuffer(Buffer.from("hello"));
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test("readReleaseInfo: null wenn pubspec fehlt", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apkrel-"));
  assert.equal(readReleaseInfo(tmp), null);
});

test("readReleaseInfo: liest version+sha256 aus tmp-projekt", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apkrel-"));
  fs.writeFileSync(path.join(tmp, "pubspec.yaml"),
    "name: x\nversion: 2.5.1+42\n");
  const apkDir = path.join(tmp, "build", "app", "outputs", "flutter-apk");
  fs.mkdirSync(apkDir, { recursive: true });
  const apk = path.join(apkDir, "app-debug.apk");
  fs.writeFileSync(apk, Buffer.from("FAKEAPK"));
  const info = readReleaseInfo(tmp);
  assert.equal(info.version, "2.5.1+42");
  assert.equal(info.semver, "2.5.1");
  assert.equal(info.build, 42);
  assert.equal(info.size, 7);
  assert.equal(info.sha256, sha256OfBuffer(Buffer.from("FAKEAPK")));
  assert.equal(info.apkPath, apk);
});

test("readReleaseInfo: liefert null bei null-rootDir", () => {
  assert.equal(readReleaseInfo(null), null);
});
