"use strict";

/**
 * Pure helper: baut Push-Notification-Payloads aus cloud-code-/idea-Events.
 * Wird vom server.js via broadcast({type:"PUSH_NOTIFICATION", notification})
 * an mobile-/desktop-Apps verteilt. Keine I/O hier — testbar mit node:test.
 *
 * Public API: buildNotification(event, { now, genId }) → notification | null
 *
 * Events: cc_done, cc_error, idea_added, idea_processed
 */

const MAX_BODY = 140;

function clip(text) {
  if (!text) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > MAX_BODY ? s.slice(0, MAX_BODY - 1) + "…" : s;
}

function buildNotification(event, deps) {
  if (!event || !event.type) return null;
  const now = (deps && deps.now) ? deps.now() : new Date().toISOString();
  const genId = (deps && deps.genId) ? deps.genId : () => "n" + Date.now();
  const name = event.projectName || "Projekt";

  let title, body, priority = "normal";
  switch (event.type) {
    case "cc_done": {
      const ok = event.exitCode === 0;
      title = `${name}: cloud-code ${ok ? "fertig" : "mit fehler"}`;
      const extra = event.suggestionsApplied
        ? ` · ${event.suggestionsApplied} regel-vorschläge` : "";
      body = ok
        ? `aufgabe erfolgreich abgeschlossen${extra}`
        : `beendet mit exit ${event.exitCode}${extra}`;
      priority = ok ? "normal" : "high";
      break;
    }
    case "cc_error":
      title = `${name}: cloud-code fehler`;
      body = clip(event.error || "unbekannter fehler");
      priority = "high";
      break;
    case "idea_added":
      title = `${name}: neue idee`;
      body = clip(event.ideaText);
      priority = "low";
      break;
    case "idea_processed":
      title = `${name}: idee verarbeitet`;
      body = (event.action === "task_created" ? "in aufgabe übernommen: " : "verworfen: ")
        + clip(event.ideaText);
      body = clip(body);
      priority = "low";
      break;
    default:
      return null;
  }
  return {
    id: genId(),
    type: event.type,
    title,
    body,
    projectId: event.projectId || null,
    priority,
    createdAt: now,
  };
}

module.exports = { buildNotification };
