"use strict";
/**
 * lib/setup_check.js
 * Pre-flight für first-user-experience: prüft ob alle deps für ein cc-run
 * verfügbar sind. Wird vom UI gepingt (welcome-banner falls was fehlt).
 *
 * Liefert pro tool: { name, available, version?, hint?, severity }
 * severity: "critical" (cc-features blockiert) · "optional" (only specific use-cases)
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function _which(cmd, args = ["--version"], timeoutMs = 3000) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    let proc;
    try {
      proc = spawn(cmd, args, {
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      return finish({ ok: false, error: e.message });
    }
    proc.stdout.on("data", (c) => { if (out.length < 500) out += c.toString(); });
    proc.stderr.on("data", (c) => { if (out.length < 500) out += c.toString(); });
    proc.on("error", () => finish({ ok: false }));
    proc.on("close", (code) => finish({ ok: code === 0, version: out.split(/\r?\n/)[0].trim() }));
    setTimeout(() => { try { proc.kill(); } catch (_) {} finish({ ok: false, error: "timeout" }); }, timeoutMs);
  });
}

async function runSetupCheck({ baseDir }) {
  const checks = await Promise.all([
    _which("node", ["--version"]).then(r => ({
      name: "node",
      severity: "critical",
      available: r.ok,
      version: r.version,
      hint: r.ok ? null : "node.js erforderlich · https://nodejs.org/de/download",
    })),
    _which("claude", ["--version"]).then(r => ({
      name: "claude-cli",
      severity: "critical",
      available: r.ok,
      version: r.version,
      hint: r.ok ? null : "claude CLI fehlt · npm install -g @anthropic-ai/claude-code · dann claude auth login",
    })),
    _which("git", ["--version"]).then(r => ({
      name: "git",
      severity: "optional",
      available: r.ok,
      version: r.version,
      hint: r.ok ? null : "git fehlt · cc per-task-commits deaktiviert · https://git-scm.com/download/win",
    })),
    _whichFlutter(baseDir).then(r => ({
      name: "flutter",
      severity: "optional",
      available: r.ok,
      version: r.version,
      source: r.source,
      hint: r.ok ? null : "flutter SDK fehlt · mobile-app-rebuild deaktiviert · https://docs.flutter.dev/get-started/install",
    })),
    _whichAdb().then(r => ({
      name: "adb",
      severity: "optional",
      available: r.ok,
      version: r.version,
      hint: r.ok ? null : "adb fehlt · USB-handy-pairing deaktiviert (WLAN/tunnel funktioniert ohne)",
    })),
  ]);

  const critical = checks.filter(c => c.severity === "critical" && !c.available);
  return {
    ok: critical.length === 0,
    blockers: critical.length,
    checks,
  };
}

async function _whichFlutter(baseDir) {
  // Erst lokale Flutter-bin probieren (per repo), dann global
  if (baseDir) {
    const local = path.join(baseDir, "Flutter", "flutter", "bin",
      process.platform === "win32" ? "flutter.bat" : "flutter");
    if (fs.existsSync(local)) {
      const r = await _which(local, ["--version"], 5000);
      if (r.ok) return { ok: true, version: r.version, source: "local" };
    }
  }
  const g = await _which("flutter", ["--version"], 5000);
  return { ...g, source: g.ok ? "global" : null };
}

async function _whichAdb() {
  // Standard-Android-SDK-pfad auf Windows
  const localAdb = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools",
        process.platform === "win32" ? "adb.exe" : "adb")
    : null;
  if (localAdb && fs.existsSync(localAdb)) {
    return _which(localAdb, ["version"], 3000);
  }
  return _which("adb", ["version"], 3000);
}

module.exports = { runSetupCheck };
