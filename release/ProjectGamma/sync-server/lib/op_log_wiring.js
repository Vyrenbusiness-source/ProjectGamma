'use strict';

/**
 * lib/op_log_wiring.js
 * Schicht 3 des delta-sync-rollouts: schmaler glue-helper, der server.js-mutate
 * an op_log_store + op_broadcast bindet, ohne dass server.js direkte queries
 * gegen op_log fahren muss (regel: persistenz nur via store-modul, fanout nur
 * via op_broadcast).
 *
 * Oeffentliche API:
 *   recordAndBroadcastOp({ store, broadcast, projectId, op, originDeviceId, clients, send })
 *     -> { op, frame, recipients }
 *
 *   resyncSince({ store, projectId, since, sendTo, send })
 *     -> { frame, count }   // baut OP_BATCH frame und sendet an einen client
 *
 * Pure-glue: keine ws-imports, keine sqlite-imports. Aufrufer injiziert
 * store (op_log_store-instanz) und send-funktion (default: ws.send(JSON.stringify)).
 */

const { buildOpAppendFrame, buildOpBatchFrame, selectRecipients } = require('./op_broadcast');

function defaultSend(client, frame) {
  if (!client || typeof client.send !== 'function') return false;
  try { client.send(JSON.stringify(frame)); return true; }
  catch (e) { console.warn('[op_log_wiring] send fehlgeschlagen', e && e.message); return false; }
}

function recordAndBroadcastOp({ store, projectId, op, originDeviceId, clients, send }) {
  if (!store || typeof store.appendOp !== 'function') {
    throw new Error('recordAndBroadcastOp: store mit appendOp pflichtfeld');
  }
  if (!projectId) throw new Error('recordAndBroadcastOp: projectId pflichtfeld');
  if (!op || !op.opId || !op.type || !op.deviceId) {
    throw new Error('recordAndBroadcastOp: op {opId,type,deviceId} pflichtfeld');
  }

  const persisted = store.appendOp(projectId, op);
  const frame = buildOpAppendFrame(projectId, persisted);
  const recipients = selectRecipients(clients || [], { projectId, excludeDeviceId: originDeviceId });
  const sender = typeof send === 'function' ? send : defaultSend;
  let delivered = 0;
  for (const c of recipients) {
    if (sender(c, frame)) delivered += 1;
  }
  return { op: persisted, frame, recipients, delivered };
}

function resyncSince({ store, projectId, since, sendTo, send }) {
  if (!store || typeof store.opsSince !== 'function') {
    throw new Error('resyncSince: store mit opsSince pflichtfeld');
  }
  if (!projectId) throw new Error('resyncSince: projectId pflichtfeld');
  const cursor = Number.isFinite(since) ? since : 0;
  const ops = store.opsSince(projectId, cursor);
  const frame = buildOpBatchFrame(projectId, ops);
  let delivered = false;
  if (sendTo) {
    const sender = typeof send === 'function' ? send : defaultSend;
    delivered = sender(sendTo, frame);
  }
  return { frame, count: ops.length, delivered };
}

module.exports = { recordAndBroadcastOp, resyncSince };
