// Pure-JS Pre-Run-Linter für Cloud-Code.
// Verantwortung: vor jedem cc-run mechanisch prüfen, dass der projekt-state
// die "kein commit ohne grünes lint"-regel nicht trivial bricht.
// errors blockieren den run; warnings sind nur info-output.
// Keine fs/network-deps — bleibt ohne mocks testbar.
"use strict";

function lintBeforeRun(project) {
  const errors = [];
  const warnings = [];

  if (!project || typeof project !== "object") {
    errors.push("kein projekt übergeben — linter braucht project-objekt");
    return { ok: false, errors, warnings };
  }

  if (!project.path || typeof project.path !== "string" || !project.path.trim()) {
    errors.push("project.path fehlt — cloud-code braucht gültigen cwd vor start");
  }

  const diffs = Array.isArray(project.ruleDiffs) ? project.ruleDiffs : [];
  const pendingDiffs = diffs.filter(d => d && d.status === "pending");
  if (pendingDiffs.length > 0) {
    // Warning statt error: pending diffs sind im UI bestätigungspflichtig,
    // dürfen aber den auto-pump nicht dauerhaft blocken (sonst läuft cc nie
    // mehr, sobald sich ein einziger ungenehmigter diff staut).
    warnings.push(
      "pending rule_diffs offen (" + pendingDiffs.length +
      ") — user kann per checkmark approve/reject auslösen"
    );
  }

  const conflicts = Array.isArray(project.conflicts) ? project.conflicts : [];
  const openConflicts = conflicts.filter(c => c && c.status !== "resolved");
  if (openConflicts.length > 0) {
    errors.push(
      "offene konflikte (" + openConflicts.length +
      ") — vor cc-run via RESOLVE_CONFLICT klären"
    );
  }

  const rules = Array.isArray(project.rules) ? project.rules : [];
  const seen = new Map();
  let emptyCount = 0;
  let activeCount = 0;
  for (const r of rules) {
    if (!r || typeof r !== "object") continue;
    const txt = typeof r.text === "string" ? r.text.trim() : "";
    if (!txt) { emptyCount += 1; continue; }
    if (r.active) activeCount += 1;
    seen.set(txt, (seen.get(txt) || 0) + 1);
  }
  for (const [txt, n] of seen) {
    if (n > 1) {
      warnings.push("duplikat-regel (" + n + "x): " + truncate(txt, 60));
    }
  }
  if (emptyCount > 0) {
    warnings.push("leere regel-texte: " + emptyCount + " (sollten entfernt werden)");
  }
  if (activeCount === 0) {
    warnings.push("keine aktiven regeln — cc läuft ohne projekt-spezifische guardrails");
  }

  return { ok: errors.length === 0, errors, warnings };
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function formatReport(result) {
  if (!result || typeof result !== "object") return "rule_linter: ungültiges result";
  const parts = [];
  parts.push("rule_linter: " + (result.ok ? "OK" : "BLOCKIERT"));
  for (const e of result.errors || []) parts.push("  ✗ " + e);
  for (const w of result.warnings || []) parts.push("  ! " + w);
  return parts.join("\n");
}

module.exports = { lintBeforeRun, formatReport };
