'use strict';

/**
 * op_broadcast: pure helpers fuer das delta-sync ws-protokoll.
 *
 * Server-wiring (Schicht 3) ruft buildOpAppendFrame nach jedem appendOp und
 * sendet das frame an selectRecipients(...). Das halten wir bewusst pure,
 * damit ws-fanout-logik testbar bleibt, ohne ws-server zu booten.
 *
 * Frame-shapes:
 *   { type: 'OP_APPEND', projectId, op }     // einzelne mutation, live-broadcast
 *   { type: 'OP_BATCH',  projectId, ops }    // since-cursor-resync nach reconnect
 *
 * Empfaenger-filter:
 *   - nur clients im selben projekt-room
 *   - excludeDeviceId: origin-device bekommt KEIN OP_APPEND (es kennt die op
 *     bereits aus dem optimistic update); andere geraete des gleichen users
 *     bekommen sie aber.
 *   - readyState===1 (OPEN), damit wir nicht in geschlossene sockets schreiben
 */

const WS_OPEN = 1;

function buildOpAppendFrame(projectId, op) {
  if (!projectId) throw new Error('projectId pflichtfeld');
  if (!op || !op.opId) throw new Error('op.opId pflichtfeld');
  if (typeof op.seq !== 'number') throw new Error('op.seq pflichtfeld');
  return { type: 'OP_APPEND', projectId, op };
}

function buildOpBatchFrame(projectId, ops) {
  if (!projectId) throw new Error('projectId pflichtfeld');
  const list = Array.isArray(ops) ? ops.slice() : [];
  list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  return { type: 'OP_BATCH', projectId, ops: list };
}

function selectRecipients(clients, { projectId, excludeDeviceId } = {}) {
  if (!Array.isArray(clients) || clients.length === 0) return [];
  if (!projectId) return [];
  const out = [];
  for (const c of clients) {
    if (!c) continue;
    if (c.projectId !== projectId) continue;
    if (c.readyState !== WS_OPEN) continue;
    if (excludeDeviceId && c.deviceId === excludeDeviceId) continue;
    out.push(c);
  }
  return out;
}

module.exports = {
  buildOpAppendFrame,
  buildOpBatchFrame,
  selectRecipients,
};
