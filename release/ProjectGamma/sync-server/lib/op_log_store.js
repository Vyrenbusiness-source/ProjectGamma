"use strict";
/**
 * lib/op_log_store.js
 * SQLite-Persistenz fuer das delta-op-log (Schicht 2 des delta-sync-rollouts).
 *
 * Trennung: lib/op_log.js bleibt pure-in-memory (testbar ohne db);
 * dieses modul ist die durable schicht. Aufruf-vertrag analog zu sqlite_store:
 * persistenz-zugriff (op-log) ausschliesslich ueber dieses modul.
 *
 * Oeffentliche API:
 *   createOpLogStore({ filename }) -> store
 *     store.appendOp(projectId, op)     -> { opId, seq, lamport, ... }
 *     store.opsSince(projectId, cursor) -> op[]   // seq > cursor, sortiert
 *     store.head(projectId)             -> { seq, lamport }
 *     store.compact(projectId, safeSeq) -> number // geloeschte ops
 *     store.close()
 *
 * Schema: ein zentraler ops-table mit project_id. seq ist per-project
 * monoton (UNIQUE(project_id, seq)), opId ist global eindeutig fuer
 * dedupe ueber project-grenzen (UNIQUE(op_id)).
 */

const { DatabaseSync } = require("node:sqlite");

function createOpLogStore({ filename }) {
  if (!filename || typeof filename !== "string") {
    throw new Error("createOpLogStore: 'filename' (path oder :memory:) erforderlich");
  }

  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS op_log (" +
      "  project_id TEXT NOT NULL," +
      "  op_id      TEXT NOT NULL," +
      "  seq        INTEGER NOT NULL," +
      "  lamport    INTEGER NOT NULL," +
      "  device_id  TEXT NOT NULL," +
      "  type       TEXT NOT NULL," +
      "  payload    TEXT NOT NULL," +
      "  ts         INTEGER NOT NULL," +
      "  PRIMARY KEY (project_id, op_id)," +
      "  UNIQUE (project_id, seq)" +
      ");"
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_op_log_project_seq ON op_log(project_id, seq);");

  const select_by_id = db.prepare(
    "SELECT op_id, seq, lamport, device_id, type, payload, ts FROM op_log WHERE project_id = ? AND op_id = ?"
  );
  const select_max_seq = db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS s, COALESCE(MAX(lamport), 0) AS l FROM op_log WHERE project_id = ?"
  );
  const insert_op = db.prepare(
    "INSERT INTO op_log (project_id, op_id, seq, lamport, device_id, type, payload, ts) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const select_since = db.prepare(
    "SELECT op_id, seq, lamport, device_id, type, payload, ts FROM op_log " +
      "WHERE project_id = ? AND seq > ? ORDER BY seq ASC"
  );
  const delete_compact = db.prepare(
    "DELETE FROM op_log WHERE project_id = ? AND seq <= ?"
  );

  function rowToOp(row) {
    let payload = {};
    try { payload = JSON.parse(row.payload); } catch (e) {
      console.warn("[op_log_store] payload nicht parsebar fuer op", row.op_id, e && e.message);
    }
    return {
      opId: row.op_id,
      seq: row.seq,
      lamport: row.lamport,
      deviceId: row.device_id,
      type: row.type,
      payload,
      ts: row.ts,
    };
  }

  function appendOp(projectId, op) {
    if (!projectId || typeof projectId !== "string") {
      throw new Error("appendOp: projectId pflichtfeld");
    }
    if (!op || typeof op !== "object") throw new Error("appendOp: op pflichtfeld");
    if (!op.deviceId) throw new Error("appendOp: op.deviceId pflichtfeld");
    if (!op.type) throw new Error("appendOp: op.type pflichtfeld");
    if (!op.opId) throw new Error("appendOp: op.opId pflichtfeld");

    const existing = select_by_id.get(projectId, op.opId);
    if (existing) return rowToOp(existing);

    const head = select_max_seq.get(projectId);
    const nextSeq = (head ? head.s : 0) + 1;
    const lamport = Number.isFinite(op.lamport) ? op.lamport : nextSeq;
    const ts = Number.isFinite(op.ts) ? op.ts : Date.now();
    const payloadJson = JSON.stringify(op.payload || {});

    insert_op.run(projectId, op.opId, nextSeq, lamport, op.deviceId, op.type, payloadJson, ts);
    return {
      opId: op.opId,
      seq: nextSeq,
      lamport,
      deviceId: op.deviceId,
      type: op.type,
      payload: op.payload || {},
      ts,
    };
  }

  function opsSince(projectId, cursor) {
    if (!projectId) throw new Error("opsSince: projectId pflichtfeld");
    const c = Number.isFinite(cursor) ? cursor : 0;
    return select_since.all(projectId, c).map(rowToOp);
  }

  function head(projectId) {
    if (!projectId) throw new Error("head: projectId pflichtfeld");
    const row = select_max_seq.get(projectId);
    return { seq: row ? row.s : 0, lamport: row ? row.l : 0 };
  }

  function compact(projectId, safeSeq) {
    if (!projectId) throw new Error("compact: projectId pflichtfeld");
    const s = Number.isFinite(safeSeq) ? safeSeq : 0;
    const res = delete_compact.run(projectId, s);
    return Number(res && res.changes ? res.changes : 0);
  }

  function close() {
    try { db.close(); } catch (_) { /* swallow on second close */ }
  }

  return { appendOp, opsSince, head, compact, close };
}

module.exports = { createOpLogStore };
