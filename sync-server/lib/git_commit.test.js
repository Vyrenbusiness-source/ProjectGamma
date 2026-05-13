"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isGitRepo, commitChanges, listCcCommits, rollbackLastCommit } = require("./git_commit.js");

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-gc-"));
  spawnSync("git", ["init", "-q"], { cwd: dir, shell: true });
  // Lokale identity setzen (CI hat oft keine globale)
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir, shell: true });
  spawnSync("git", ["config", "user.name", "test"], { cwd: dir, shell: true });
  // Initial commit damit HEAD existiert
  fs.writeFileSync(path.join(dir, "README"), "x\n");
  spawnSync("git", ["add", "README"], { cwd: dir, shell: true });
  spawnSync("git", ["commit", "-q", "-m", "init", "--no-verify"], { cwd: dir, shell: true });
  return dir;
}

test("isGitRepo: false bei nicht-repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-gc-non-"));
  assert.equal(isGitRepo(dir), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("isGitRepo: true bei echtem repo", () => {
  const dir = tempRepo();
  assert.equal(isGitRepo(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("commitChanges: skipt wenn nichts zu committen", async () => {
  const dir = tempRepo();
  const r = await commitChanges({ projectPath: dir, message: "[cc] noop" });
  assert.equal(r.committed, false);
  assert.match(r.skipped || "", /keine änderungen/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("commitChanges: skipt wenn kein git-repo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-gc-non-"));
  const r = await commitChanges({ projectPath: dir, message: "[cc] x" });
  assert.equal(r.committed, false);
  assert.match(r.skipped || "", /kein git-repo/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("commitChanges: commitet echte änderung mit message", async () => {
  const dir = tempRepo();
  fs.writeFileSync(path.join(dir, "neu.txt"), "hallo\n");
  const r = await commitChanges({
    projectPath: dir, message: "[cc] feature x",
    authorName: "cc", authorEmail: "cc@local",
  });
  assert.equal(r.committed, true);
  assert.ok(/^[0-9a-f]{7,}$/.test(r.sha));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listCcCommits: liefert nur cc-prefix-commits", async () => {
  const dir = tempRepo();
  // 1 user-commit
  fs.writeFileSync(path.join(dir, "user.txt"), "1\n");
  spawnSync("git", ["add", "user.txt"], { cwd: dir, shell: true });
  spawnSync("git", ["commit", "-q", "-m", "manual change", "--no-verify"], { cwd: dir, shell: true });
  // 2 cc-commits
  fs.writeFileSync(path.join(dir, "cc1.txt"), "1\n");
  await commitChanges({ projectPath: dir, message: "[cc] task 1" });
  fs.writeFileSync(path.join(dir, "cc2.txt"), "2\n");
  await commitChanges({ projectPath: dir, message: "[cc] task 2" });
  const log = await listCcCommits(dir, 10);
  assert.equal(log.length, 2);
  assert.match(log[0].message, /\[cc\]/);
  assert.match(log[1].message, /\[cc\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rollbackLastCommit: macht HEAD~1 hard-reset", async () => {
  const dir = tempRepo();
  fs.writeFileSync(path.join(dir, "x.txt"), "1\n");
  await commitChanges({ projectPath: dir, message: "[cc] x" });
  const before = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, shell: true, encoding: "utf8" }).stdout.trim();
  const r = await rollbackLastCommit(dir);
  assert.equal(r.ok, true);
  const after = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, shell: true, encoding: "utf8" }).stdout.trim();
  assert.notEqual(before, after);
  assert.equal(fs.existsSync(path.join(dir, "x.txt")), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
