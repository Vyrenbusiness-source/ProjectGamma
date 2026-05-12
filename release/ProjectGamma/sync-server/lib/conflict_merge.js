// Pure-Logik: merged einen patch (mobile ↔ desktop) mit konflikt-erkennung.
//
// Domain-Schicht (keine I/O). Spiegelt detectConflict aus conflict_resolver
// auf ein vollständiges patch-objekt: für jedes feld, das mit baseValues
// (was der client beim laden gesehen hat) nicht mehr übereinstimmt, wird
// ein pending-konflikt erzeugt statt still zu überschreiben.
//
// Vertrag: mergePatchWithDetection(project, {
//   patch:       { [field]: newValue, ... },
//   baseValues:  { [field]: knownValue, ... },   // client-seitiger snapshot
//   remoteDevice:string, localDevice:string,
//   remoteTs:string?,    // iso, default: now (modify-ts des remote-patch)
//   localTs:string?,     // iso, default: now (modify-ts des live-feldes;
//                        // korrigiert LWW-tiebreak bei choice=newest)
//   target:      { type:"project"|"task", id?:string } // default project
// })
// → { project, applied:[field], conflicts:[id] }
//
// Felder ohne baseValues-eintrag werden direkt überschrieben (neuanlage).
// Felder, die einen pending-konflikt erzeugen, werden NICHT überschrieben –
// der user löst sie später via RESOLVE_CONFLICT.

"use strict";

const { detectConflict } = require("./conflict_resolver");
const { valueEquals } = require("./value_equals");

function fieldOfTarget(project, target) {
  if (!target || target.type === "project") return project;
  if (target.type === "task") {
    const t = (project.tasks || []).find(x => x.id === target.id);
    if (!t) throw new Error("task nicht gefunden: " + target.id);
    return t;
  }
  throw new Error("unsupported target: " + target.type);
}

function setOnTarget(project, target, field, value) {
  if (!target || target.type === "project") {
    project[field] = value;
    return;
  }
  project.tasks = (project.tasks || []).map(t =>
    t.id === target.id ? { ...t, [field]: value } : t,
  );
}

function mergePatchWithDetection(project, input) {
  if (!project) throw new Error("project fehlt");
  const {
    patch = {},
    baseValues = {},
    remoteDevice = "remote",
    localDevice = "local",
    remoteTs,
    localTs,
    target = { type: "project" },
  } = input || {};

  const next = { ...project, conflicts: (project.conflicts || []).slice() };
  if (target.type === "project") {
    // Felder werden direkt auf next gesetzt.
  } else if (target.type === "task") {
    next.tasks = (next.tasks || []).slice();
  }

  const applied = [];
  const conflicts = [];
  const live = fieldOfTarget(next, target);

  for (const field of Object.keys(patch)) {
    const remoteValue = patch[field];
    const liveValue = live[field];
    const baseValue = Object.prototype.hasOwnProperty.call(baseValues, field)
      ? baseValues[field]
      : undefined;

    // Kein baseValue → erstanlage / kein konflikt möglich.
    if (baseValue === undefined) {
      setOnTarget(next, target, field, remoteValue);
      applied.push(field);
      continue;
    }
    // Remote-wert identisch zum live-wert → no-op.
    if (valueEquals(liveValue, remoteValue)) continue;

    // Live wurde seit base nicht verändert → einfach übernehmen.
    if (valueEquals(liveValue, baseValue)) {
      setOnTarget(next, target, field, remoteValue);
      applied.push(field);
      continue;
    }

    // Beide seiten haben seit base divergiert → konflikt einfügen.
    const c = detectConflict({
      field,
      localValue: liveValue,
      remoteValue,
      localDevice,
      remoteDevice,
      target,
      remoteTs,
      localTs,
    });
    if (c) {
      next.conflicts.push(c);
      conflicts.push(c.id);
    }
  }

  return { project: next, applied, conflicts };
}

module.exports = { mergePatchWithDetection };
