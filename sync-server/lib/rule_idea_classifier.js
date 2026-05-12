// Heuristik: trennt cloud-code RULE_SUGGESTIONS.add-Einträge in
// echte universelle Regeln (Verhalten/Stil) vs. projektspezifische
// Ideen/Task-Learnings, die NICHT als Regel landen sollten.
//
// Hintergrund: Claude emittiert auf die RULE_SUGGESTIONS-Aufforderung
// gerne lange task-bezogene Memos wie „store.json → sqlite migration in
// zwei tasks splitten". Das sind eigentlich Ideen/TODOs, keine Regeln.
//
// Pure-JS · keine I/O · testbar via node:test.
"use strict";

const MAX_RULE_LEN = 140; // länger ⇒ vermutlich Task-Beschreibung
// Pfad-/Datei-marker: konkrete Dateien sind task-spezifisch, nicht universal
const PATH_RX = /(?:[a-z0-9_\-]+\/){1,}[a-z0-9_\-]+\.(?:js|jsx|dart|ts|tsx|json|md|yaml|yml|html|css)\b|\/lib\/|\/features\/|sync-server\/|desktop-app\/|mobile-app\//i;
// Action-verben (irgendwo im text): deuten auf TODO/Idee statt regel
// Wortstämme (kein \b am ende, damit auch konjugierte formen matchen,
// z.b. "implementiere", "implementieren", "anlegen", "anlege").
const ACTION_RX = /\b(?:splitt|teil|trenn|anleg|extrahier|implementier|hinzuf[üue]g|umbau|migrier|verschieb|umbenenn|refactor|behebe|reparier|verdraht|einricht|wiring|wir(?:e|ed))/i;
// Konkrete code-symbole / dateinamen — task-artig
const CODE_SYMBOL_RX = /\b[a-z][a-zA-Z0-9_\-]*\.(?:js|jsx|dart|ts|tsx|json|md|yaml|yml|html|css|sql|sqlite|bat|sh)\b/i;

/**
 * Klassifiziert einen RULE_SUGGESTIONS.add-Eintrag.
 * @returns {"rule"|"idea"} — "rule" = universelle Verhaltensregel,
 *                            "idea" = projekt-/task-spezifisches TODO
 */
function classify(text) {
  const t = String(text || "").trim();
  if (!t) return "idea";
  if (t.length > MAX_RULE_LEN) return "idea";
  if (PATH_RX.test(t)) return "idea";
  if (ACTION_RX.test(t)) return "idea";
  if (CODE_SYMBOL_RX.test(t)) return "idea";
  return "rule";
}

module.exports = { classify };
