// Pure side-by-side-diff helper für das conflict-modal (desktop-app).
//
// Erzeugt aligned rows (lokal | remote) per zeilen-LCS, ohne dom/react.
// Wird in node (require, tests) und im browser (window.ConflictDiff) genutzt.
// Spiegelt die mobile pure-dart-logik in
// features/conflicts/conflict_diff.dart, damit beide apps das gleiche
// rendering-modell teilen (gerätesynchrones verhalten).

(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.ConflictDiff = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * Splittet text in zeilen (akzeptiert \n und \r\n). Leerer/null input → [].
   * @param {string|null|undefined} text
   * @returns {Array<string>}
   */
  function splitLines(text) {
    if (text == null || text === "") return [];
    return String(text).split(/\r?\n/);
  }

  // O(n*m) LCS-länge-matrix. Für conflict-werte (i.d.r. < 50 zeilen) ok.
  function lcsMatrix(a, b) {
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        if (a[i] === b[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }
    return dp;
  }

  /**
   * Liefert aligned diff-zeilen für side-by-side rendering.
   * Jede zeile: { kind: "equal"|"add"|"remove"|"change", left, right }.
   * left=null für add-only-zeile, right=null für remove-only-zeile.
   * @param {string} local
   * @param {string} remote
   */
  function computeSideBySide(local, remote) {
    const a = splitLines(local);
    const b = splitLines(remote);
    if (a.length === 0 && b.length === 0) return [];
    const dp = lcsMatrix(a, b);
    const ops = [];
    let i = a.length;
    let j = b.length;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        ops.push({ kind: "equal", left: a[i - 1], right: b[j - 1] });
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        ops.push({ kind: "remove", left: a[i - 1], right: null });
        i--;
      } else {
        ops.push({ kind: "add", left: null, right: b[j - 1] });
        j--;
      }
    }
    while (i > 0) {
      ops.push({ kind: "remove", left: a[i - 1], right: null });
      i--;
    }
    while (j > 0) {
      ops.push({ kind: "add", left: null, right: b[j - 1] });
      j--;
    }
    ops.reverse();
    return pairChanges(ops);
  }

  // Paart benachbarte remove+add zu 'change' für saubere alignment.
  function pairChanges(ops) {
    const rows = [];
    for (let k = 0; k < ops.length; k++) {
      const cur = ops[k];
      const next = ops[k + 1];
      if (next && cur.kind === "remove" && next.kind === "add") {
        rows.push({ kind: "change", left: cur.left, right: next.right });
        k++;
      } else if (next && cur.kind === "add" && next.kind === "remove") {
        rows.push({ kind: "change", left: next.left, right: cur.right });
        k++;
      } else {
        rows.push(cur);
      }
    }
    return rows;
  }

  /**
   * Schnell-check: enthält das diff überhaupt eine änderung?
   * @param {Array} rows
   */
  function hasChanges(rows) {
    return rows.some((r) => r.kind !== "equal");
  }

  return { splitLines, computeSideBySide, hasChanges };
});
