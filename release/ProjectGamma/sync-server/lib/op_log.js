'use strict';

/**
 * op_log: pure in-memory delta-log für sync.
 *
 * Jede mutation wird als op {opId, seq, lamport, deviceId, type, payload, ts}
 * persistiert. Clients holen seit ihrer letzten bekannten seq nur das delta
 * (since), statt einen full-state-snapshot zu transferieren.
 *
 * Lamport-clock: stellt totale ordnung über geräte hinweg sicher; seq ist
 * server-lokal monoton und für since-cursor-pagination da.
 *
 * Persistenz/wiring (sqlite_store, ws-broker) liegt im aufrufer — dieses
 * modul bleibt pure-js, damit tdd ohne server-boot möglich ist.
 */

const ALLOWED_FIELDS = ['opId', 'seq', 'lamport', 'deviceId', 'type', 'payload', 'ts'];

function pickOp(op) {
  const out = {};
  for (const k of ALLOWED_FIELDS) if (op[k] !== undefined) out[k] = op[k];
  return out;
}

function createOpLog(state) {
  const ops = [];
  const seenOpIds = new Set();
  let seq = 0;
  let lamport = 0;

  if (state && Array.isArray(state.ops)) {
    for (const raw of state.ops) {
      const op = pickOp(raw);
      ops.push(op);
      if (op.opId) seenOpIds.add(op.opId);
      if (op.seq > seq) seq = op.seq;
      if (op.lamport > lamport) lamport = op.lamport;
    }
  }

  function nextOpId() {
    return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function append({ deviceId, type, payload, opId, ts }) {
    if (!deviceId) throw new Error('op.deviceId pflichtfeld');
    if (!type) throw new Error('op.type pflichtfeld');
    const id = opId || nextOpId();
    if (seenOpIds.has(id)) {
      return ops.find(o => o.opId === id);
    }
    seq += 1;
    lamport += 1;
    const op = {
      opId: id,
      seq,
      lamport,
      deviceId,
      type,
      payload: payload || {},
      ts: ts || Date.now(),
    };
    ops.push(op);
    seenOpIds.add(id);
    return op;
  }

  function mergeRemote(remoteOps) {
    const inserted = [];
    for (const raw of remoteOps || []) {
      if (!raw || !raw.opId || !raw.type || !raw.deviceId) continue;
      if (seenOpIds.has(raw.opId)) continue;
      seq += 1;
      const remoteLamport = Number.isFinite(raw.lamport) ? raw.lamport : 0;
      lamport = Math.max(lamport, remoteLamport) + 1;
      const op = {
        opId: raw.opId,
        seq,
        lamport: remoteLamport > 0 ? remoteLamport : lamport,
        deviceId: raw.deviceId,
        type: raw.type,
        payload: raw.payload || {},
        ts: raw.ts || Date.now(),
      };
      ops.push(op);
      seenOpIds.add(raw.opId);
      inserted.push(op);
    }
    return inserted;
  }

  function since(cursorSeq) {
    const cursor = Number.isFinite(cursorSeq) ? cursorSeq : 0;
    return ops.filter(o => o.seq > cursor).map(pickOp);
  }

  function compact(safeSeq) {
    const before = ops.length;
    for (let i = ops.length - 1; i >= 0; i--) {
      if (ops[i].seq <= safeSeq) {
        if (ops[i].opId) seenOpIds.delete(ops[i].opId);
        ops.splice(i, 1);
      }
    }
    return before - ops.length;
  }

  function head() {
    return { seq, lamport };
  }

  function toJSON() {
    return { ops: ops.map(pickOp) };
  }

  return { append, mergeRemote, since, compact, head, toJSON };
}

module.exports = { createOpLog };
