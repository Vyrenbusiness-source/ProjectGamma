// Pure helpers für die rule-diffs-UI (desktop-app).
//
// Trennt Datenformung von der jsx-Komponente, damit per node:test ohne
// browser-stack getestet werden kann. Wird sowohl in node (require) als
// auch im browser (window-global) genutzt.

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.RuleDiffsViewHelpers = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * Liefert nur pending diff-Einträge eines projects.
   * @param {{ruleDiffs?: Array}|null|undefined} project
   * @returns {Array}
   */
  function selectPending(project) {
    if (!project || !Array.isArray(project.ruleDiffs)) return [];
    return project.ruleDiffs.filter((d) => d && d.status === "pending");
  }

  /**
   * Anzahl pending diffs (für badge/chip).
   */
  function countPending(project) {
    return selectPending(project).length;
  }

  /**
   * Menschen-lesbares label für einen diff.
   */
  function formatDiffLabel(diff) {
    if (!diff) return "";
    const text = diff.text || "";
    if (diff.action === "activate") return `aktivieren: ${text}`;
    if (diff.action === "deactivate") return `deaktivieren: ${text}`;
    return `änderung: ${text}`;
  }

  return { selectPending, countPending, formatDiffLabel };
});
