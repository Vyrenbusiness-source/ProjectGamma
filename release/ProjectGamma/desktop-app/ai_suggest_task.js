/**
 * Pure-JS · heuristische "KI"-Suggestion fuer Idee -> Aufgabe (Desktop).
 * Spiegelt mobile-app/lib/features/idea_to_task/ai_suggest_task.dart.
 * Keine DOM-/React-Imports -> testbar via node:test.
 *
 * Public API:
 *  - aiSuggestTask(raw): { title, meta, priority } | null
 */
'use strict';

const HIGH_KEYS = ['dringend', 'urgent', 'asap', 'sofort', 'wichtig'];
const LOW_KEYS = ['vielleicht', 'mal', 'irgendwann', 'evtl', 'optional'];
const MAX_TITLE = 80;

function capFirst(s) {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function aiSuggestTask(raw) {
  const t = (raw || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const isHigh = HIGH_KEYS.some(k => lower.includes(k));
  const isLow = !isHigh && LOW_KEYS.some(k => lower.includes(k));

  let cleaned = t;
  for (const k of [...HIGH_KEYS, ...LOW_KEYS]) {
    cleaned = cleaned.replace(new RegExp(k, 'gi'), '');
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) cleaned = t;
  const title = capFirst(truncate(cleaned, MAX_TITLE));

  if (isHigh) return { title, meta: 'hoch · ki-vorschlag', priority: 4 };
  if (isLow) return { title, meta: 'niedrig · ki-vorschlag', priority: 2 };
  return { title, meta: 'aus idee', priority: 3 };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { aiSuggestTask };
}
if (typeof window !== 'undefined') {
  window.aiSuggestTask = aiSuggestTask;
}
