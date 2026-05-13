"use strict";
/**
 * lib/git_commit.js
 * Per-task git-commit nach erfolgreichem cc-run. Damit ist jede
 * cc-änderung rollback-fähig (git reset --hard <vor-commit>) und die
 * history zeigt sauber was cc gemacht hat.
 *
 * Pure spawn-wrapper · keine LLM-calls · komplett offline.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { killTreeSync } = require("./process_kill");

function isGitRepo(projectPath) {
  if (!projectPath) return false;
  try { return fs.statSync(path.join(projectPath, ".git")).isDirectory(); }
  catch (_) { return false; }
}

function _runGit(args, cwd, timeoutMs = 30 * 1000) {
  return new Promise((resolve) => {
    let buf = "";
    // shell:false damit args nicht von cmd.exe re-parsed werden — sonst werden
    // commit-messages mit [klammern] oder spaces als pathspecs missinterpretiert.
    // git ist .exe (kein .bat), braucht keinen shell.
    const proc = spawn("git", args, {
      cwd, shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    // windows: child.kill() killt nur top-process — git kann credential-helper
    // subprozesse haben. killTreeSync nutzt taskkill /T /F im windows-fall.
    const timer = setTimeout(() => killTreeSync(proc, { signal: "SIGKILL" }), timeoutMs);
    proc.stdout.on("data", (c) => { buf += c.toString(); });
    proc.stderr.on("data", (c) => { buf += c.toString(); });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: String(e && e.message), exitCode: -1 });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, output: buf.slice(-4000) });
    });
  });
}

/**
 * Macht git add (gezielt für cc-geänderte files) + git commit. Skipt
 * sauber wenn:
 *  - kein git-repo
 *  - nichts zu committen
 *
 * Wichtig: stages NUR die files die cc in filesChanged gemeldet hat. So
 * werden user-in-progress-edits NICHT in den cc-commit reingezogen
 * (kritisch wenn user parallel zum cc-run editiert). Ohne filesChanged
 * fällt es auf das alte `git add -A`-verhalten zurück (für legacy-callsites).
 *
 * @returns {{committed:boolean, skipped?:string, sha?:string, error?:string, stagedFiles?:string[]}}
 */
async function commitChanges({ projectPath, message, authorName, authorEmail, filesChanged }) {
  if (!isGitRepo(projectPath)) {
    return { committed: false, skipped: "kein git-repo" };
  }
  // Was hat sich geändert?
  const status = await _runGit(["status", "--porcelain"], projectPath);
  if (!status.ok) return { committed: false, error: "git status fehler: " + status.output };
  if (!status.output.trim()) {
    return { committed: false, skipped: "keine änderungen zu committen" };
  }
  // Konfig-overrides nur lokal pro commit (kein global write)
  const cfg = [];
  if (authorName) cfg.push("-c", "user.name=" + authorName);
  if (authorEmail) cfg.push("-c", "user.email=" + authorEmail);

  // Selektiver add: nur die files die cc selber geändert hat. paths sind
  // typischerweise relativ zum project-root, manchmal absolut — wir
  // normalisieren beides via path.relative.
  let stagedFiles = [];
  if (Array.isArray(filesChanged) && filesChanged.length > 0) {
    const relFiles = [];
    for (const f of filesChanged) {
      if (typeof f !== "string" || !f.trim()) continue;
      let abs = path.isAbsolute(f) ? f : path.join(projectPath, f);
      let rel = path.relative(projectPath, abs).replace(/\\/g, "/");
      // sicherheits-check: nicht außerhalb des projekts stagen
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      // null-bytes / shell-tricks raus
      if (/[\0\n\r]/.test(rel)) continue;
      if (relFiles.length < 500) relFiles.push(rel);
    }
    if (relFiles.length === 0) {
      return { committed: false, skipped: "filesChanged nach normalisierung leer" };
    }
    // Erst pathspecs-from-stdin nutzen wäre robuster, aber komplexer.
    // -- als pathspec-trenner schützt vor flag-injection in filenames.
    const add = await _runGit(["add", "--", ...relFiles], projectPath);
    if (!add.ok) {
      return { committed: false, error: "git add (selektiv) fehler: " + add.output };
    }
    stagedFiles = relFiles;
  } else {
    // Legacy-fallback: alte callsites ohne filesChanged. console-warn damit
    // bei migration auffällt dass die noch umgestellt werden müssen.
    console.warn("[git_commit] commitChanges ohne filesChanged → fallback auf git add -A");
    const add = await _runGit(["add", "-A"], projectPath);
    if (!add.ok) return { committed: false, error: "git add fehler: " + add.output };
  }
  // FIX #15: message sanitize — null-bytes + CRLF raus, auf 200 chars cap
  // (titles können user-input enthalten, sind keine geprüften strings)
  const safeMsg = String(message || "[cc] auto-commit")
    .replace(/[\r\n\0\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "[cc] auto-commit";
  // --no-verify: cc soll nicht durch pre-commit-hooks blockiert werden
  // (linter/test-hooks würden den autonom-flow zerschießen — wir haben
  // schon build-gate + self-review als gates).
  const commitArgs = [...cfg, "commit", "-m", safeMsg, "--no-verify"];
  const commit = await _runGit(commitArgs, projectPath);
  if (!commit.ok) return { committed: false, error: "git commit fehler: " + commit.output };
  const rev = await _runGit(["rev-parse", "--short", "HEAD"], projectPath);
  return {
    committed: true,
    sha: rev.ok ? rev.output.trim() : "?",
    stagedFiles: stagedFiles.length > 0 ? stagedFiles : undefined,
  };
}

/** Hard-reset auf den letzten commit (vor dem aktuellen cc-run-commit).
 *  Nutzt git reset --hard HEAD~1 — nur lokal, kein push. */
async function rollbackLastCommit(projectPath) {
  if (!isGitRepo(projectPath)) return { ok: false, error: "kein git-repo" };
  const r = await _runGit(["reset", "--hard", "HEAD~1"], projectPath);
  return r.ok ? { ok: true } : { ok: false, error: r.output };
}

/** Liefert die letzten N cc-commits aus git log (für UI-history). */
async function listCcCommits(projectPath, limit = 20) {
  if (!isGitRepo(projectPath)) return [];
  const r = await _runGit(
    ["log", "--grep=^\\[cc\\]", "-n", String(limit), "--pretty=format:%h|%ad|%s", "--date=unix"],
    projectPath,
  );
  if (!r.ok) return [];
  return r.output.split("\n").filter(Boolean).map((line) => {
    const [sha, ts, ...rest] = line.split("|");
    return { sha, ts: Number(ts) * 1000, message: rest.join("|") };
  });
}

module.exports = { isGitRepo, commitChanges, rollbackLastCommit, listCcCommits };
