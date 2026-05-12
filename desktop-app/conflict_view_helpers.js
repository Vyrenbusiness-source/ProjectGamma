// Pure helpers für die conflict-resolution-UI (desktop-app).
//
// Trennt Datenformung + Payload-Bau von der jsx-Komponente, damit per
// node:test ohne browser-stack getestet werden kann. Wird sowohl in node
// (require) als auch im browser (window-global) genutzt.
// Spiegelt die mobile pure-dart logik in features/conflicts/conflict_resolver.dart.

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.ConflictViewHelpers = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * Liefert nur pending-Konflikte eines projects, älteste zuerst.
   * @param {{conflicts?: Array}|null|undefined} project
   * @returns {Array}
   */
  function selectPending(project) {
    if (!project || !Array.isArray(project.conflicts)) return [];
    return project.conflicts
      .filter((c) => c && c.status === "pending")
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(a.detectedAt || "") || 0;
        const tb = Date.parse(b.detectedAt || "") || 0;
        return ta - tb;
      });
  }

  function countPending(project) {
    return selectPending(project).length;
  }

  function formatConflictLabel(c) {
    if (!c) return "";
    return `${c.field || "?"}: ${c.localDevice || "?"} ↔ ${c.remoteDevice || "?"}`;
  }

  function previewFor(c, choice) {
    if (!c) return "";
    return choice === "local" ? (c.localValue || "") : (c.remoteValue || "");
  }

  /**
   * Baut das Dispatch-Payload für RESOLVE_CONFLICT.
   * @throws {Error} wenn conflictId leer oder choice ungültig.
   */
  function buildResolvePayload(conflictId, choice) {
    if (!conflictId) throw new Error("conflictId darf nicht leer sein");
    if (choice !== "local" && choice !== "remote") {
      throw new Error("choice muss local|remote sein");
    }
    return { conflictId, choice };
  }

  return {
    selectPending,
    countPending,
    formatConflictLabel,
    previewFor,
    buildResolvePayload,
  };
});
