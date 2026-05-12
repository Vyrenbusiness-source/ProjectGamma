"use strict";
/**
 * lib/sqlite_store.js
 * Atomarer Persistenz-Layer fuer den sync-server. Ersetzt store.json.
 *
 * Oeffentliche API (Regel: persistenz ausschliesslich ueber dieses Modul):
 *   createSqliteStore({ filename }) -> store
 *     store.loadState(defaults)        : object  // KV-blob unter key='state'
 *     store.saveState(stateObject)     : void    // ueberschreibt blob
 *     store.transaction(fn)            : T       // BEGIN/COMMIT, ROLLBACK on throw
 *     store.migrateFromJson(jsonObj)   : bool    // true = uebernommen, false = bereits vorhanden
 *     store.close()                    : void
 *
 * Schema bewusst minimal (single-blob), da server.js heute den gesamten
 * state als ein JSON-Objekt liest/schreibt. Spaetere Migration auf
 * relationale Tabellen kann denselben Vertrag behalten.
 */

const { DatabaseSync } = require("node:sqlite");

const STATE_KEY = "state";

function createSqliteStore({ filename }) {
  if (!filename || typeof filename !== "string") {
    throw new Error("createSqliteStore: 'filename' (path or :memory:) erforderlich");
  }

  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS kv_store (" +
      "  k TEXT PRIMARY KEY," +
      "  v TEXT NOT NULL," +
      "  updated_at INTEGER NOT NULL" +
      ");"
  );

  const get_stmt = db.prepare("SELECT v FROM kv_store WHERE k = ?");
  const upsert_stmt = db.prepare(
    "INSERT INTO kv_store (k, v, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at"
  );

  function loadState(defaults) {
    const row = get_stmt.get(STATE_KEY);
    if (!row) return defaults;
    try {
      return JSON.parse(row.v);
    } catch (e) {
      // Korrupte Zeile sichtbar machen statt silent-skip (vgl. aktive Regel).
      console.warn("[sqlite_store] state-blob nicht parsebar:", e && e.message);
      return defaults;
    }
  }

  function saveState(stateObject) {
    if (stateObject === undefined || stateObject === null) {
      throw new Error("saveState: stateObject darf nicht null/undefined sein");
    }
    const json = JSON.stringify(stateObject);
    upsert_stmt.run(STATE_KEY, json, Date.now());
  }

  function transaction(fn) {
    if (typeof fn !== "function") {
      throw new Error("transaction: fn (function) erforderlich");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch (rollbackErr) {
        console.warn("[sqlite_store] rollback fehlgeschlagen:", rollbackErr && rollbackErr.message);
      }
      throw err;
    }
  }

  function migrateFromJson(jsonObj) {
    if (!jsonObj || typeof jsonObj !== "object") {
      throw new Error("migrateFromJson: jsonObj erforderlich");
    }
    const existing = get_stmt.get(STATE_KEY);
    if (existing) return false;
    saveState(jsonObj);
    return true;
  }

  function close() {
    try { db.close(); } catch (_) { /* swallow on second close */ }
  }

  return {
    loadState,
    saveState,
    transaction,
    migrateFromJson,
    close,
    // db-accessor für lib/users_store + lib/project_membership.
    // Bewusste lockerung der „nur dieses modul"-regel, damit die multi-user-
    // schichten dieselbe sqlite-instance (WAL+foreign_keys=ON) teilen. Die
    // table-zugehörigkeit bleibt strikt (users_store ↔ users, etc.).
    get db() { return db; },
  };
}

module.exports = { createSqliteStore };
