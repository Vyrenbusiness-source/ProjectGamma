"use strict";
/**
 * lib/runtime_test.js
 * Programmatischer runtime-check NACH build-gate, VOR self-review.
 * Zweck: cc-änderungen müssen nicht nur kompilieren — der echte server
 * muss starten + auf /health antworten, das frontend muss laden.
 *
 * 0 LLM-tokens · pure spawn + http.
 *
 * Tech-detection ähnlich build_gate, aber andere kommandos:
 *   - node-server: spawn → wait für port-listen → curl /health → kill
 *   - static-frontend: spawn python http.server → curl /index.html → kill
 *   - flutter mobile: skip (APK-rebuild + adb-install passiert separat)
 *
 * Smart trigger: nur wenn cc files in runtime-relevanten dirs geändert hat
 * (server.js, *.html, lib/, etc.) — sonst skip.
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

// FIX #14: auf windows killt child.kill() nur den top-process, nicht das
// process-tree (z.B. cmd.exe → node.exe). Wir nutzen `taskkill /F /T /PID`
// um den ganzen baum zu beenden — sonst bleibt der port bei retries belegt.
function _killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    try {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
        windowsHide: true, stdio: "ignore",
      });
      return;
    } catch (_) { /* fallback */ }
  }
  try { child.kill("SIGTERM"); } catch (_) {}
  setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 800);
}

/**
 * Filtert eine filesChanged-liste auf runtime-relevante files.
 * Heuristik: js/dart/html/jsx/ts/server.* → ja; .md/.txt/test/ → nein.
 */
function shouldRunRuntime(filesChanged) {
  if (!Array.isArray(filesChanged) || filesChanged.length === 0) return false;
  return filesChanged.some((f) => {
    const fp = String(f).toLowerCase();
    if (fp.includes("/test/") || fp.includes("\\test\\") ||
        fp.includes(".test.") || fp.endsWith(".md") || fp.endsWith(".txt") ||
        fp.includes("/docs/") || fp.endsWith(".gitignore")) return false;
    return /\.(js|jsx|ts|tsx|dart|html|css|json|yaml|yml|sh|bat)$/i.test(fp) ||
           fp.includes("server.") || fp.includes("main.") || fp.includes("app.");
  });
}

/** Erkennt project-tech für runtime-test. */
function detectRuntime(projectPath) {
  if (!projectPath || !fs.existsSync(projectPath)) return null;
  // 1. node server: package.json mit start-script oder server.js
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.scripts && pkg.scripts.start) {
        return { kind: "node-server", startScript: "start", pkg };
      }
    } catch (_) {}
  }
  if (fs.existsSync(path.join(projectPath, "server.js"))) {
    return { kind: "node-server", entry: "server.js" };
  }
  // 2. static-frontend: index.html im root
  if (fs.existsSync(path.join(projectPath, "index.html"))) {
    return { kind: "static-frontend" };
  }
  return null;
}

function _findFreePort(start = 19500) {
  // Best-effort: try a port range, return first free one (sync via net-test).
  // Falls 19500..19599 alle belegt sind → null (caller skipt).
  const net = require("node:net");
  return new Promise((resolve) => {
    const tryPort = (p) => {
      if (p > start + 100) return resolve(null);
      const s = net.createServer();
      s.once("error", () => tryPort(p + 1));
      s.once("listening", () => {
        const got = s.address().port;
        s.close(() => resolve(got));
      });
      s.listen(p, "127.0.0.1");
    };
    tryPort(start);
  });
}

function _httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => { if (body.length < 4000) body += c.toString(); });
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
    });
    req.on("error", (e) => resolve({ ok: false, status: 0, body: e.message }));
    req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch (_) {} resolve({ ok: false, status: 0, body: "timeout" }); });
  });
}

function _waitForListen(port, host = "127.0.0.1", probePath = "/health", timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = async () => {
      if (Date.now() - start > timeoutMs) return resolve({ ok: false, status: 0, body: "wait-timeout" });
      const r = await _httpGet(`http://${host}:${port}${probePath}`, 1500);
      if (r.ok) return resolve(r);
      setTimeout(tick, 400);
    };
    tick();
  });
}

/** Runtime-test ausführen. Liefert { ok, kind, output, durationMs, skipped? }. */
async function runRuntimeTest({ projectPath, filesChanged, env }) {
  const start = Date.now();
  if (!shouldRunRuntime(filesChanged || [])) {
    return { ok: true, skipped: true, kind: "none",
      output: "keine runtime-relevanten files geändert (skip)", durationMs: 0 };
  }
  const tech = detectRuntime(projectPath);
  if (!tech) {
    return { ok: true, skipped: true, kind: "none",
      output: "keine runtime-tech erkannt", durationMs: 0 };
  }

  if (tech.kind === "node-server") {
    const port = await _findFreePort();
    if (!port) {
      return { ok: true, skipped: true, kind: tech.kind,
        output: "kein freier port — skip", durationMs: Date.now() - start };
    }
    const child = tech.startScript
      ? spawn(process.platform === "win32" ? "npm.cmd" : "npm",
              ["run", tech.startScript],
              { cwd: projectPath, shell: false, env: { ...process.env, ...(env || {}), PORT: String(port) }, windowsHide: true })
      : spawn("node", [tech.entry],
              { cwd: projectPath, shell: false, env: { ...process.env, ...(env || {}), PORT: String(port) }, windowsHide: true });
    let buf = "";
    child.stdout && child.stdout.on("data", (c) => { if (buf.length < 4000) buf += c.toString(); });
    child.stderr && child.stderr.on("data", (c) => { if (buf.length < 4000) buf += c.toString(); });

    const probe = await _waitForListen(port);
    // Cleanup egal ob ok oder nicht — tree-kill für windows-process-trees
    _killTree(child);

    if (probe.ok) {
      // Optional: JSON-body interpretieren bei /health
      let healthSummary = "";
      try {
        const data = JSON.parse(probe.body);
        if (data && data.ok === true) healthSummary = "health ok";
      } catch (_) {}
      return {
        ok: true, skipped: false, kind: tech.kind,
        output: `node-server: PORT=${port} → /health ${probe.status} ${healthSummary}`.slice(-4000),
        durationMs: Date.now() - start,
      };
    }
    return {
      ok: false, skipped: false, kind: tech.kind,
      output: `node-server: PORT=${port} → /health fail (${probe.body})\nstdout/stderr:\n` + buf.slice(-2000),
      durationMs: Date.now() - start,
    };
  }

  if (tech.kind === "static-frontend") {
    // Static-frontend: wir probieren python -m http.server, dann curl /index.html.
    const port = await _findFreePort();
    if (!port) return { ok: true, skipped: true, kind: tech.kind, output: "kein freier port", durationMs: Date.now() - start };
    const child = spawn(process.platform === "win32" ? "python.exe" : "python3",
      ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
      { cwd: projectPath, shell: false, env: process.env, windowsHide: true });
    let buf = "";
    child.stderr && child.stderr.on("data", (c) => { if (buf.length < 2000) buf += c.toString(); });

    const probe = await _waitForListen(port, "127.0.0.1", "/index.html");
    try { child.kill("SIGTERM"); } catch (_) {}
    setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 1500);

    if (probe.ok && /<html|<!doctype/i.test(probe.body)) {
      return { ok: true, skipped: false, kind: tech.kind,
        output: `static-frontend: index.html ${probe.status} (${probe.body.length}B html)`,
        durationMs: Date.now() - start };
    }
    return {
      ok: false, skipped: false, kind: tech.kind,
      output: `static-frontend fail: ${probe.body.slice(0, 500)}\n${buf.slice(-500)}`,
      durationMs: Date.now() - start,
    };
  }

  return { ok: true, skipped: true, kind: "unknown", output: "tech unhandled", durationMs: Date.now() - start };
}

module.exports = { shouldRunRuntime, detectRuntime, runRuntimeTest };
