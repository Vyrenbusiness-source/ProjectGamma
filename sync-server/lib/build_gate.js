"use strict";
/**
 * lib/build_gate.js
 * Echte verifikation nach cc-mutation: project-tech erkennen, dann
 * den passenden check ausführen (flutter analyze, npm test, etc.).
 *
 * Erst wenn der gate grün ist, darf self-review starten. Damit fallen
 * fake-checkmarks weg, bei denen cc behauptet „done:true" aber das
 * resultat nicht baut.
 *
 * Pure-helper für die detection (testbar ohne spawn); spawn-runner ist
 * separat damit fs/process mockbar bleibt.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// Reihenfolge ist wichtig: flutter-projekte haben oft auch ein package.json
// (für tooling), aber pubspec.yaml ist der eindeutige indikator.
const TECH_CHECKS = [
  {
    name: "flutter",
    detect: (dir) => fs.existsSync(path.join(dir, "pubspec.yaml")),
    // analyze ist schnell + deckt 90% der broken-imports / type-errors ab.
    // test wäre besser, dauert aber zu lange für jeden cc-run.
    // --no-fatal-warnings: alte unused-vars/unused-imports blockieren cc
    // sonst bei jedem run — würde retry-loops verursachen.
    cmd: process.platform === "win32" ? "flutter.bat" : "flutter",
    args: ["analyze", "--no-fatal-infos", "--no-fatal-warnings"],
    timeoutMs: 90 * 1000,
  },
  {
    name: "node",
    detect: (dir) => {
      if (!fs.existsSync(path.join(dir, "package.json"))) return false;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        return !!(pkg && pkg.scripts && (pkg.scripts.test || pkg.scripts.check));
      } catch (_) { return false; }
    },
    cmd: process.platform === "win32" ? "npm.cmd" : "npm",
    // --silent unterdrückt npm-eigene logs; das script selbst sieht man weiter.
    // -- --reporter=spec falls user mocha nutzt — sonst harmlos.
    args: ["test", "--silent"],
    timeoutMs: 180 * 1000,
  },
  {
    name: "python",
    detect: (dir) =>
      fs.existsSync(path.join(dir, "pyproject.toml")) ||
      fs.existsSync(path.join(dir, "setup.py")),
    cmd: process.platform === "win32" ? "python.exe" : "python3",
    args: ["-m", "pytest", "-q", "--no-header"],
    timeoutMs: 180 * 1000,
  },
  {
    name: "rust",
    detect: (dir) => fs.existsSync(path.join(dir, "Cargo.toml")),
    cmd: "cargo",
    args: ["check", "--quiet"],
    timeoutMs: 180 * 1000,
  },
];

/**
 * Erkennt project-tech, ohne zu spawnen.
 * @param {string} projectPath
 * @returns {{name, cmd, args, timeoutMs} | null}
 */
function detectCheck(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return null;
  for (const t of TECH_CHECKS) {
    try {
      if (t.detect(projectPath)) return { ...t };
    } catch (_) { /* tech-detect-error → nächste tech */ }
  }
  return null;
}

/**
 * Führt den build-gate aus. Liefert { ok, kind, output, durationMs, skipped? }.
 * skipped:true wenn keine bekannte tech detected wurde — in dem fall darf
 * self-review fortlaufen (kein build-check vorhanden ist KEIN fehler).
 */
function runBuildGate({ projectPath, customCmd, customArgs, onProgress }) {
  return new Promise((resolve) => {
    const start = Date.now();
    let check;
    if (customCmd) {
      check = { name: "custom", cmd: customCmd, args: customArgs || [], timeoutMs: 120 * 1000 };
    } else {
      check = detectCheck(projectPath);
    }
    if (!check) {
      return resolve({
        ok: true, skipped: true, kind: "none",
        output: "kein build-check für project-tech erkannt (keine pubspec.yaml/package.json/etc.)",
        durationMs: 0,
      });
    }
    let killed = false;
    let buf = "";
    const proc = spawn(check.cmd, check.args, {
      cwd: projectPath,
      shell: true, // notwendig wegen .bat/.cmd auf windows
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill("SIGKILL"); } catch (_) {}
    }, check.timeoutMs);
    proc.stdout.on("data", (c) => {
      const s = c.toString();
      buf += s;
      if (onProgress) try { onProgress(s); } catch (_) {}
    });
    proc.stderr.on("data", (c) => {
      const s = c.toString();
      buf += s;
      if (onProgress) try { onProgress(s); } catch (_) {}
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        ok: false, skipped: false, kind: check.name,
        output: "spawn fehler: " + (e && e.message),
        durationMs: Date.now() - start,
        commandMissing: /ENOENT/.test(String(e && e.message)),
      });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: !killed && code === 0,
        skipped: false,
        kind: check.name,
        exitCode: code,
        timedOut: killed,
        output: buf.slice(-8000), // letzte 8kB, mehr braucht der prompt nicht
        durationMs: Date.now() - start,
        cmd: check.cmd + " " + check.args.join(" "),
      });
    });
  });
}

module.exports = { detectCheck, runBuildGate, TECH_CHECKS };
