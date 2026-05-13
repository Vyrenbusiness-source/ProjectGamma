"use strict";
/**
 * lib/process_kill.js
 * Plattform-aware kill-helper für spawned child-processes.
 *
 * Warum:
 *  Auf windows beendet `child.kill()` (intern TerminateProcess auf dem
 *  top-handle) nur den direkten prozess, NICHT seine sub-prozesse. Bei
 *  `spawn(cmd, args, { shell: true })` oder `cmd.exe → node.exe → …` bleiben
 *  die kinder verwaist und halten ports/locks weiter offen. Korrekter weg:
 *  `taskkill /pid <pid> /T /F` killt den ganzen prozessbaum.
 *  Auf posix funktioniert `child.kill(signal)` (signaliert process-group
 *  bei detached:true, sonst das einzelne kind — was für unsere callsites
 *  reicht). Dieser helper kapselt den unterschied an einer stelle.
 *
 * 0 deps · pure spawn.
 *
 * Public API:
 *  - killTreeSync(child, opts?)      → bool : sofort, hart auf windows
 *  - killTreeGraceful(child, opts?)  → void : SIGTERM → SIGKILL (unix)
 *                                            bzw. taskkill /T /F (windows)
 */

const { spawnSync } = require("node:child_process");

/**
 * Kappt einen spawn-child synchron. Auf windows wird der ganze prozessbaum
 * via `taskkill /pid /T /F` beendet (sonst bleiben sub-processes verwaist
 * und halten ports/locks). Auf posix wird `child.kill(signal)` verwendet.
 *
 * @param {import("node:child_process").ChildProcess|null} child
 * @param {Object} [opts]
 * @param {"SIGTERM"|"SIGKILL"|string} [opts.signal="SIGTERM"]  posix-signal
 * @param {string} [opts._platform]      override für tests
 * @param {Function} [opts._spawnSync]   override für tests
 * @returns {boolean} true wenn ein kill-versuch ausgeführt wurde
 */
function killTreeSync(child, opts = {}) {
  if (!child || child.killed) return false;
  const platform = opts._platform || process.platform;
  const signal = opts.signal || "SIGTERM";
  if (platform === "win32" && child.pid) {
    const runner = opts._spawnSync || spawnSync;
    try {
      const r = runner("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      // taskkill: 0 = ok · 128 = "process not found" (auch ok) · sonst fallback
      if (r && (r.status === 0 || r.status === 128)) return true;
    } catch (_) { /* fällt unten durch */ }
  }
  try { child.kill(signal); return true; } catch (_) { return false; }
}

/**
 * Versucht den prozessbaum erst weich zu beenden, killt nach `gracefulMs`
 * hart nach. Auf windows existiert kein zuverlässiges weiches signal für
 * trees — daher direkt taskkill /T /F (identisch zu killTreeSync).
 *
 * @param {import("node:child_process").ChildProcess|null} child
 * @param {Object} [opts]
 * @param {number} [opts.gracefulMs=800]  delay zwischen SIGTERM und SIGKILL (posix)
 * @param {string} [opts._platform]       override für tests
 * @param {Function} [opts._spawnSync]    override für tests
 * @param {Function} [opts._setTimeout]   override für tests
 * @returns {void}
 */
function killTreeGraceful(child, opts = {}) {
  if (!child || child.killed) return;
  const platform = opts._platform || process.platform;
  if (platform === "win32") {
    killTreeSync(child, opts);
    return;
  }
  try { child.kill("SIGTERM"); } catch (_) {}
  const gracefulMs = typeof opts.gracefulMs === "number" ? opts.gracefulMs : 800;
  const timerFn = opts._setTimeout || setTimeout;
  timerFn(() => {
    try { if (child && !child.killed) child.kill("SIGKILL"); } catch (_) {}
  }, gracefulMs);
}

module.exports = { killTreeSync, killTreeGraceful };
