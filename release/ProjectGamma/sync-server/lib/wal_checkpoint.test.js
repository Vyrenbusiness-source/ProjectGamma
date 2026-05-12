"use strict";
/**
 * Tests fuer lib/wal_checkpoint.js
 * Pure-helper: ruft PRAGMA wal_checkpoint(mode) auf einer DatabaseSync-instanz.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { checkpointWal, ALLOWED_MODES } = require("./wal_checkpoint");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walchk-"));
  const file = path.join(dir, "t.db");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);");
  for (let i = 0; i < 50; i++) db.exec(`INSERT INTO t (v) VALUES ('x${i}');`);
  return { db, file, dir };
}

test("checkpointWal: default-modus PASSIVE liefert {busy,log,checkpointed}-zahlen", () => {
  const { db, dir } = freshDb();
  const res = checkpointWal(db);
  assert.strictEqual(typeof res.busy, "number");
  assert.strictEqual(typeof res.log, "number");
  assert.strictEqual(typeof res.checkpointed, "number");
  assert.ok(res.log >= 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("checkpointWal: TRUNCATE-modus schrumpft -wal-file", () => {
  const { db, file, dir } = freshDb();
  const walFile = file + "-wal";
  const beforeSize = fs.existsSync(walFile) ? fs.statSync(walFile).size : 0;
  assert.ok(beforeSize > 0, "wal-file sollte vor checkpoint inhalt haben");
  const res = checkpointWal(db, "TRUNCATE");
  assert.strictEqual(res.busy, 0);
  const afterSize = fs.existsSync(walFile) ? fs.statSync(walFile).size : 0;
  assert.strictEqual(afterSize, 0, "TRUNCATE muss -wal auf 0 zurueckschneiden");
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("checkpointWal: unbekannter modus wirft", () => {
  const { db, dir } = freshDb();
  assert.throws(() => checkpointWal(db, "BOGUS"), /modus/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("checkpointWal: fehlende db wirft", () => {
  assert.throws(() => checkpointWal(null), /db/);
});

test("ALLOWED_MODES enthaelt die vier sqlite-standardmodi", () => {
  assert.deepStrictEqual(
    [...ALLOWED_MODES].sort(),
    ["FULL", "PASSIVE", "RESTART", "TRUNCATE"]
  );
});
