// Pure-Logik: löst einen sync-konflikt mobile ↔ desktop auf einem project.
//
// Domain-Schicht (keine I/O, kein server-state). Wird vom MUT.RESOLVE_CONFLICT
// im server.js und vom desktop conflict_modal/dart-pendant gespiegelt genutzt.
//
// Vertrag: project.conflicts: [{ id, field, localValue, remoteValue,
// localDevice, remoteDevice, status, detectedAt, target:{type,id} }]
// choice ∈ {"local","remote","newest"} — "newest" nutzt detectedAt-tiebreak
// nicht das field selbst; deterministisch via lastWriteWins-helper.
//
// Rückgabe: { project, applied:{field, value, choice, conflictId} }.
// Wirft Error bei unbekannter conflictId oder ungültigem choice.

"use strict";

const { valueEquals } = require("./value_equals");

const VALID_CHOICES = new Set(["local", "remote", "newest"]);

/** Last-write-wins tiebreak anhand iso-ts auf dem conflict-eintrag. */
function lastWriteWins(conflict) {
  const lt = Date.parse(conflict.localTs || conflict.detectedAt || "") || 0;
  const rt = Date.parse(conflict.remoteTs || conflict.detectedAt || "") || 0;
  return rt > lt ? "remote" : "local";
}

/** Wendet value auf project[field] oder auf project.tasks[id][field] an. */
function applyValue(project, conflict, value) {
  const target = conflict.target || { type: "project" };
  if (target.type === "project") {
    project[conflict.field] = value;
    return;
  }
  if (target.type === "task") {
    project.tasks = (project.tasks || []).map(t =>
      t.id === target.id ? { ...t, [conflict.field]: value } : t,
    );
    return;
  }
  throw new Error("unsupported conflict target: " + target.type);
}

/**
 * Löst einen pending-konflikt im project (immutable wrt. project-input).
 * @param {object} project
 * @param {{conflictId:string, choice:string}} input
 * @returns {{project:object, applied:object}}
 */
function resolveConflict(project, input) {
  if (!project || !Array.isArray(project.conflicts)) {
    throw new Error("project hat keine conflicts");
  }
  const { conflictId, choice } = input || {};
  if (!conflictId) throw new Error("conflictId darf nicht leer sein");
  if (!VALID_CHOICES.has(choice)) {
    throw new Error("choice muss local|remote|newest sein");
  }
  const c = project.conflicts.find(x => x && x.id === conflictId);
  if (!c) throw new Error("conflict nicht gefunden: " + conflictId);
  if (c.status !== "pending") {
    throw new Error("conflict bereits aufgelöst: " + conflictId);
  }

  const finalChoice = choice === "newest" ? lastWriteWins(c) : choice;
  const value = finalChoice === "local" ? c.localValue : c.remoteValue;

  const next = { ...project, conflicts: project.conflicts.map(x => x) };
  applyValue(next, c, value);
  next.conflicts = next.conflicts.map(x =>
    x.id === conflictId
      ? { ...x, status: "resolved", choice: finalChoice, resolvedAt: new Date().toISOString() }
      : x,
  );
  return {
    project: next,
    applied: { field: c.field, value, choice: finalChoice, conflictId },
  };
}

/**
 * Erkennt einen konflikt zwischen lokal und remote update.
 * Liefert null wenn werte gleich sind (kein konflikt), sonst conflict-eintrag.
 */
function detectConflict({ field, localValue, remoteValue, localDevice, remoteDevice, target, localTs, remoteTs }) {
  if (valueEquals(localValue, remoteValue)) return null;
  const now = new Date().toISOString();
  return {
    id: "cf_" + Math.random().toString(36).slice(2, 10),
    field, localValue, remoteValue,
    localDevice: localDevice || "local",
    remoteDevice: remoteDevice || "remote",
    status: "pending",
    detectedAt: now,
    localTs: localTs || now,
    remoteTs: remoteTs || now,
    target: target || { type: "project" },
  };
}

module.exports = { resolveConflict, detectConflict, lastWriteWins };
