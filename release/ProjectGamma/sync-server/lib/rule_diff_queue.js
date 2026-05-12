// Pending rule-diff-queue für cloud-code RULE_SUGGESTIONS.
//
// Hintergrund: Cloud-Code-Vorschläge dürfen aktive/inaktive Regeln nicht
// direkt umschalten (kein direkter TOGGLE_RULE in server.js). Stattdessen
// sammeln wir activate/deactivate-Vorschläge hier als pending-diffs, die
// der User per Checkmark approved oder rejected. So bleibt das
// Regel-System bestätigungspflichtig — keine Änderung ohne Checkmark.
//
// Pures Modul (keine Seiteneffekte, keine I/O), damit es per node:test
// ohne Server-Stack getestet werden kann.

const DEFAULT_LIMIT = 200;

function normalize(t) { return String(t || "").trim().toLowerCase(); }
function randomId() { return Math.random().toString(36).slice(2, 10); }

/**
 * Erzeugt pending-diff-Einträge aus einer RULE_SUGGESTIONS-Payload.
 * Liefert nur Diffs, die etwas verändern würden (z.B. deactivate nur für
 * aktive Regel mit passendem Text). Erzeugt KEINE Diffs für "add" —
 * neue Regel-Vorschläge gehen weiter via ADD_RULE (active:false).
 *
 * @param {object} project  — { rules: [{id,text,active}] }
 * @param {object} suggestion — { activate?: string[], deactivate?: string[] }
 * @param {{now?:Function, genId?:Function}} deps
 * @returns {Array} diff-Einträge (nicht mutierend)
 */
function buildDiffs(project, suggestion, { now = Date.now, genId = randomId } = {}) {
  if (!project || !suggestion) return [];
  const rules = Array.isArray(project.rules) ? project.rules : [];
  const out = [];
  (suggestion.deactivate || []).forEach((t) => {
    const r = rules.find((x) => normalize(x.text) === normalize(t) && x.active);
    if (r) out.push({ id: genId(), ts: now(), action: "deactivate", ruleId: r.id, text: r.text, status: "pending" });
  });
  (suggestion.activate || []).forEach((t) => {
    const r = rules.find((x) => normalize(x.text) === normalize(t) && !x.active);
    if (r) out.push({ id: genId(), ts: now(), action: "activate", ruleId: r.id, text: r.text, status: "pending" });
  });
  return out;
}

/**
 * Hängt neue Diffs an `project.ruleDiffs` an. Dedupliziert gegen bereits
 * vorhandene pending-Einträge mit gleicher action+ruleId.
 */
function enqueue(project, diffs, { limit = DEFAULT_LIMIT } = {}) {
  const queue = Array.isArray(project.ruleDiffs) ? project.ruleDiffs : [];
  const fresh = (diffs || []).filter(
    (d) => !queue.some((q) => q.status === "pending" && q.action === d.action && q.ruleId === d.ruleId),
  );
  return { ...project, ruleDiffs: [...fresh, ...queue].slice(0, limit) };
}

function listPending(project) {
  return (project && project.ruleDiffs ? project.ruleDiffs : []).filter((d) => d.status === "pending");
}

/**
 * Wendet einen pending-diff an: schaltet die Regel um und markiert den
 * Eintrag als "approved". Idempotent: nicht-pending Einträge werden
 * ignoriert.
 * @returns {{project:object, applied:boolean}}
 */
function approveDiff(project, diffId) {
  const queue = Array.isArray(project && project.ruleDiffs) ? project.ruleDiffs : [];
  const diff = queue.find((d) => d.id === diffId && d.status === "pending");
  if (!diff) return { project, applied: false };
  const rules = (project.rules || []).map((r) => {
    if (r.id !== diff.ruleId) return r;
    if (diff.action === "activate") return { ...r, active: true };
    if (diff.action === "deactivate") return { ...r, active: false };
    return r;
  });
  const ruleDiffs = queue.map((d) => (d.id === diffId ? { ...d, status: "approved" } : d));
  return { project: { ...project, rules, ruleDiffs }, applied: true };
}

/** Markiert pending-diff als "rejected", ohne die Regel zu ändern. */
function rejectDiff(project, diffId) {
  const queue = Array.isArray(project && project.ruleDiffs) ? project.ruleDiffs : [];
  const exists = queue.some((d) => d.id === diffId && d.status === "pending");
  if (!exists) return { project, rejected: false };
  const ruleDiffs = queue.map((d) => (d.id === diffId ? { ...d, status: "rejected" } : d));
  return { project: { ...project, ruleDiffs }, rejected: true };
}

module.exports = { buildDiffs, enqueue, listPending, approveDiff, rejectDiff };
