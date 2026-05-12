"use strict";
/**
 * lib/wal_checkpoint.js
 * Pure-helper: kapselt `PRAGMA wal_checkpoint(<mode>)` fuer beliebige
 * node:sqlite DatabaseSync-instanzen. Verhindert unbegrenztes Wachstum der
 * <db>-wal-datei, ohne in sqlite_store.js zu inlinen (Regel: ein modul =
 * eine verantwortlichkeit; sqlite_store bleibt KV-blob-fokussiert).
 *
 * Oeffentliche API:
 *   checkpointWal(db, mode = "PASSIVE") -> { busy, log, checkpointed }
 *   ALLOWED_MODES : Set<string>
 *
 * Modi (SQLite-Dokumentation):
 *   PASSIVE  - nicht-blockierend, nur was geht
 *   FULL     - wartet auf reader, schreibt komplettes wal
 *   RESTART  - wie FULL + wartet auf weitere reader, setzt wal zurueck
 *   TRUNCATE - wie RESTART + schneidet -wal-file auf 0 bytes
 *
 * Rueckgabe-felder entsprechen SQLites checkpoint-result:
 *   busy         : 1 wenn checkpoint blockiert war, sonst 0
 *   log          : frames im wal vor checkpoint
 *   checkpointed : frames die zurueck in die hauptdb geschrieben wurden
 */

const ALLOWED_MODES = new Set(["PASSIVE", "FULL", "RESTART", "TRUNCATE"]);

function checkpointWal(db, mode = "PASSIVE") {
  if (!db || typeof db.prepare !== "function") {
    throw new Error("checkpointWal: 'db' (DatabaseSync) erforderlich");
  }
  const m = String(mode).toUpperCase();
  if (!ALLOWED_MODES.has(m)) {
    throw new Error(`checkpointWal: unbekannter modus '${mode}'`);
  }
  const stmt = db.prepare(`PRAGMA wal_checkpoint(${m});`);
  const row = stmt.get() || {};
  return {
    busy: Number(row.busy || 0),
    log: Number(row.log || 0),
    checkpointed: Number(row.checkpointed || 0),
  };
}

module.exports = { checkpointWal, ALLOWED_MODES };
