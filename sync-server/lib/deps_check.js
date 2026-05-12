"use strict";
/**
 * lib/deps_check.js
 * Detection + Bewertung aller externen abhängigkeiten, die ProjectGamma
 * für den vollen funktions-umfang braucht.
 *
 *  - claude        (anthropic CLI) — PFLICHT für cloud-code
 *  - node          (server runtime) — schon laufend, version-check
 *  - ngrok         (public-tunnel, optional)
 *  - flutter       (mobile-rebuild, optional)
 *  - adb           (phone-install, optional)
 *
 * Pure-modul mit injizierbarem spawnSync für tests.
 */

const path = require("path");
const child_process = require("child_process");

const DEFAULT_TIMEOUT_MS = 4000;

function tryRun(spawnSync, bin, args, opts = {}) {
  try {
    const r = spawnSync(bin, args, {
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: DEFAULT_TIMEOUT_MS,
      ...opts,
    });
    if (r.status === 0 && r.stdout) {
      return { ok: true, version: r.stdout.trim().split("\n")[0], bin };
    }
    return { ok: false, error: r.stderr || ("exit " + r.status), bin };
  } catch (e) {
    return { ok: false, error: e.message, bin };
  }
}

function resolveCandidates(name) {
  if (process.platform !== "win32") return [name];
  const out = [];
  if (name === "claude") {
    out.push(path.join(process.env.APPDATA || "", "npm", "claude.cmd"));
    out.push(path.join(process.env.USERPROFILE || "", ".local", "bin", "claude.exe"));
    out.push("claude.cmd"); out.push("claude");
  } else if (name === "flutter") {
    out.push("flutter.bat"); out.push("flutter");
  } else if (name === "adb") {
    out.push(path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"));
    out.push("adb.exe"); out.push("adb");
  } else {
    out.push(name);
  }
  return out;
}

function detectOne(name, versionArgs = ["--version"], spawnSync = child_process.spawnSync) {
  for (const cand of resolveCandidates(name)) {
    if (!cand) continue;
    if (path.isAbsolute(cand)) {
      try {
        if (!require("fs").existsSync(cand)) continue;
      } catch (_) { continue; }
    }
    const r = tryRun(spawnSync, cand, versionArgs);
    if (r.ok) return { ok: true, version: r.version, bin: cand };
  }
  return { ok: false, error: `${name} nicht im PATH gefunden` };
}

function checkAll({ spawnSync = child_process.spawnSync } = {}) {
  return {
    claude:  { required: true,  install: { npm: "@anthropic-ai/claude-code" }, ...detectOne("claude", ["--version"], spawnSync) },
    node:    { required: true,  install: null, ...detectOne("node",   ["--version"], spawnSync) },
    flutter: { required: false, install: { url: "https://flutter.dev/docs/get-started/install" }, ...detectOne("flutter", ["--version"], spawnSync) },
    adb:     { required: false, install: { url: "https://developer.android.com/studio/releases/platform-tools" }, ...detectOne("adb", ["--version"], spawnSync) },
  };
}

/** Liste der fehlenden REQUIRED deps mit ihrer install-info. */
function missingRequired(report) {
  const out = [];
  for (const [name, info] of Object.entries(report)) {
    if (info.required && !info.ok) out.push({ name, install: info.install, error: info.error });
  }
  return out;
}

module.exports = { checkAll, missingRequired, detectOne };
