// ProjectGamma · Sync-Server
// HTTP-API + WebSocket für Realtime-Sync zwischen Desktop und Mobile.
// Pairing: Desktop ruft /api/pair/init auf → 6-stelliger Code (10 min TTL).
// Mobile sendet /api/pair/claim mit Code → bekommt Session-Token zurück.
// Authentifizierte Clients verbinden sich per WS und erhalten alle State-Updates.

const express = require("express");
const http = require("http");
const https = require("https");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { WebSocketServer } = require("ws");
const { bootstrapTls } = require("./lib/tls_bootstrap");
const { assertSafeProjectPath } = require("./lib/safe_path");
const { resolveLiveSession } = require("./lib/ws_session_guard");
const { resolveDefaultProjectPath } = require("./lib/default_project_path");
const { normalizeClaimDeviceType, isDesktopSession } = require("./auth_guards");
const { createClaimRateLimiter } = require("./lib/claim_rate_limit");
const ruleDiffQueue = require("./lib/rule_diff_queue");
const { buildNotification } = require("./lib/notify_dispatch");
const { summarizeDevices, publicView: deviceView } = require("./lib/device_registry");
const apkRelease = require("./lib/apk_release");
const { lintBeforeRun: lintCcRules, formatReport: formatCcLint } = require("./lib/rule_linter");
const { classify: classifyRuleOrIdea } = require("./lib/rule_idea_classifier");
const { resolveMcpConfig, cleanupResolvedConfig } = require("./lib/mcp_resolver");
const { pickTopK: _pickContextTopK } = require("./lib/context_retrieval");
const { createUsersStore } = require("./lib/users_store");
const { createProjectMembershipStore, ROLES } = require("./lib/project_membership");
const { killTreeSync, killTreeGraceful } = require("./lib/process_kill");
const { hashPassword, verifyPassword } = require("./lib/password_hash");
const { filterStateForSession, checkMutationAccess } = require("./lib/project_access");
const { createOpLogStore } = require("./lib/op_log_store");
const { buildOpAppendFrame, selectRecipients } = require("./lib/op_broadcast");
const { runBuildGate } = require("./lib/build_gate");
const { commitChanges: gitCommitChanges, isGitRepo: gitIsRepo, listCcCommits: gitListCcCommits, rollbackLastCommit: gitRollbackLast } = require("./lib/git_commit");
const { createStreamJsonParser } = require("./lib/stream_json_parser");
const { runRuntimeTest } = require("./lib/runtime_test");
const { runSetupCheck } = require("./lib/setup_check");
const { createUserSettingsStore, KNOWN_KEYS: SETTING_KEYS } = require("./lib/user_settings");
const { createUpnpPortmap } = require("./lib/upnp_portmap");
const { createPublicIpResolver } = require("./lib/public_ip");
const { createCloudflareTunnel } = require("./lib/cloudflare_tunnel");
const { checkAll: depsCheckAll, missingRequired: depsMissingRequired } = require("./lib/deps_check");

function emitPush(event) {
  const project = event.projectId && state.projects.find(p => p.id === event.projectId);
  const n = buildNotification(
    { ...event, projectName: project && project.name },
    { now: NOW, genId },
  );
  if (!n) { console.warn("[notify] event ohne notification verworfen:", event.type); return; }
  broadcast({ type: "PUSH_NOTIFICATION", notification: n });
}

// Rate-Limit für /api/pair/claim: schützt den 6-stelligen Code vor Brute-Force.
const claimRateLimiter = createClaimRateLimiter();
// Rate-Limit für /api/auth/login: schützt user-passwörter vor brute-force.
// 20 fails / 5min ist genug schutz gegen brute, lässt aber owner+team
// ausreichend platz für vertipper. Lokale requests umgehen den limiter
// komplett (kein anti-brute-force gegen sich selbst nötig).
// Strenger als pair-claim (kürzeres window, weniger fails) — login ist deutlich
// schwerer zu erraten als ein 6-stelliger code, also wirkt das limit härter.
const loginRateLimiter = createClaimRateLimiter({ windowMs: 5 * 60 * 1000, maxFails: 20 });

const PORT = Number(process.env.PORT) || 7892;
// TLS bootstrap (default off; aktiv via TLS=1). Self-signed cert in ./tls/.
const TLS_ENABLED = process.env.TLS === "1" || process.env.TLS === "true";
const TLS_DIR = process.env.TLS_DIR || path.join(__dirname, "tls");
const TLS_INFO = bootstrapTls({ enabled: TLS_ENABLED, dir: TLS_DIR });
const STORE_FILE = path.join(__dirname, "store.json");
const STORE_DB_FILE = path.join(__dirname, "store.sqlite");
const { createSqliteStore } = require("./lib/sqlite_store");
const { createIdleTracker } = require("./lib/idle_tracker");
const PAIRING_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

// ─── State + Persistenz ──────────────────────────────────────
const NOW = () => Date.now();
const uid = () => crypto.randomBytes(4).toString("hex");

function defaultState() {
  // Fresh-install: keine projekte. UI zeigt einen Welcome-state mit
  // "+ erstes projekt anlegen"-CTA. So bekommen normale user keinen
  // demo-projektordner zugewiesen, den sie auf ihrem rechner nicht haben.
  return {
    projects: [],
    syncLog: [],
    lastFullSync: NOW(),
    ccRunning: false,
  };
}

// Persistenz: sqlite_store (regelkonform, atomare Transaktionen).
// Einmalige Live-Migration: store.json -> store.sqlite, falls DB leer ist.
let sqliteStore;
try {
  sqliteStore = createSqliteStore({ filename: STORE_DB_FILE });
} catch (e) {
  console.warn("[store] sqlite init failed, falle auf in-memory zurueck:", e && e.message);
  sqliteStore = createSqliteStore({ filename: ":memory:" });
}

let state = sqliteStore.loadState(null);
if (!state || !state.projects) {
  // DB leer -> aus store.json migrieren, falls vorhanden
  let migrated = false;
  try {
    const legacy = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    if (legacy && legacy.projects) {
      sqliteStore.migrateFromJson(legacy);
      state = legacy;
      migrated = true;
      console.log("[store] migrated store.json -> sqlite, projects:", state.projects.length);
    }
  } catch (_) { /* keine legacy datei */ }
  if (!migrated) {
    state = defaultState();
    sqliteStore.saveState(state);
    console.log("[store] using default state (initialized sqlite)");
  }
} else {
  console.log("[store] loaded from sqlite, projects:", state.projects.length);
}
// Migration: tasks ohne priority bekommen einen Default basierend auf meta
state.projects.forEach(p => {
  (p.tasks || []).forEach(t => {
    if (typeof t.priority !== "number") {
      const m = String(t.meta || "").toLowerCase();
      t.priority = m.includes("hoch") ? 4 : m.includes("mittel") ? 3 : m.includes("niedrig") ? 2 : 3;
    }
  });
});

// Verwaiste resolved-mcp-configs nach unsauberem shutdown aufräumen
try {
  for (const f of fs.readdirSync(__dirname)) {
    if (/^\.mcp\.resolved\.[a-f0-9]+\.json$/.test(f)) {
      try { fs.unlinkSync(path.join(__dirname, f)); } catch (_) {}
    }
  }
} catch (_) {}

// Multi-user schicht 1: users_store + project_membership teilen die sqlite-db.
// Die schichten sind optional — bestehende pair-sessions funktionieren weiter,
// user-accounts kommen oben drauf (sieh authMw: löst sowohl device-token als
// auch user-token auf).
const USER_SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
let usersStore = null;
let memberships = null;
try {
  usersStore = createUsersStore({ db: sqliteStore.db });
  memberships = createProjectMembershipStore({ db: sqliteStore.db });
  // Abgelaufene user-sessions beim boot räumen
  const purged = usersStore.purgeExpired();
  if (purged > 0) console.log("[users] purged expired sessions:", purged);
} catch (e) {
  console.warn("[users] multi-user wiring deaktiviert:", e && e.message);
}

// Schicht 3: op_log_store für delta-sync. Eigene db-file, damit kompaktierung
// und WAL-traffic den state-blob nicht ausbremsen. Wird beim boot geöffnet.
const OP_LOG_DB_FILE = path.join(__dirname, "op_log.sqlite");
let opLogStore = null;
try {
  opLogStore = createOpLogStore({ filename: OP_LOG_DB_FILE });
  console.log("[op_log] store geöffnet:", OP_LOG_DB_FILE);
} catch (e) {
  console.warn("[op_log] store deaktiviert:", e && e.message);
}

// User-settings (API-keys etc.) — global, JSON-persistiert, NICHT in sqlite,
// damit ohne db-migration änderbar und transparent fürs file-system.
const SETTINGS_FILE = path.join(__dirname, "user_settings.json");
const userSettings = createUserSettingsStore({ file: SETTINGS_FILE });

// Claude-CLI detection beim boot: gibt klares feedback statt cryptischer
// fehler beim ersten cc-run. Result wird im /api/setup/status sichtbar.
let claudeCliInfo = { installed: false, version: null, path: null, error: null };
(function detectClaudeCli() {
  const candidates = process.platform === "win32"
    ? [
        path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
        path.join(process.env.USERPROFILE || "", ".local", "bin", "claude.exe"),
        "claude.cmd",
      ]
    : ["claude"];
  for (const bin of candidates) {
    if (!bin) continue;
    if (path.isAbsolute(bin) && !fs.existsSync(bin)) continue;
    try {
      const r = require("child_process").spawnSync(bin, ["--version"], {
        timeout: 5000, encoding: "utf8", shell: process.platform === "win32",
      });
      if (r.status === 0 && r.stdout) {
        claudeCliInfo = { installed: true, version: r.stdout.trim().split("\n")[0], path: bin, error: null };
        console.log("[claude] CLI erkannt:", claudeCliInfo.version, "@", bin);
        return;
      }
    } catch (e) { /* try next */ }
  }
  claudeCliInfo.error = "claude CLI nicht gefunden — install via: npm i -g @anthropic-ai/claude-code";
  console.warn("[claude] " + claudeCliInfo.error);
})();

// Zentrale claude-binary-resolution für alle spawn-call-sites.
// Nutzt das beim boot detektierte resultat (claudeCliInfo.path) — deckt
// sowohl npm-globale (.cmd) als auch Anthropic-standalone (.exe in
// ~/.local/bin) installation ab. Fallback bleibt die alte windows-suche
// für den fall, dass detection beim boot fehlschlug.
// Cache für claudeBin-resolution: bei jedem spawn fs.existsSync auf 3 paths
// ist teuer wenn cc auto-pumpt. 5min TTL ist konservativ — wenn der user
// claude-cli neu installiert, müsste er eh den server neustarten.
let _claudeBinCache = null;
let _claudeBinCacheTs = 0;
const _CLAUDE_BIN_TTL_MS = 5 * 60 * 1000;
function resolveClaudeBinary() {
  if (claudeCliInfo.path && claudeCliInfo.path !== "auto-installed") return claudeCliInfo.path;
  const now = Date.now();
  if (_claudeBinCache && now - _claudeBinCacheTs < _CLAUDE_BIN_TTL_MS) return _claudeBinCache;
  if (process.platform !== "win32") {
    _claudeBinCache = "claude";
    _claudeBinCacheTs = now;
    return _claudeBinCache;
  }
  const candidates = [
    path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
    path.join(process.env.USERPROFILE || "", ".local", "bin", "claude.exe"),
    "claude.cmd",
  ];
  for (const c of candidates) {
    if (c && (!path.isAbsolute(c) || fs.existsSync(c))) {
      _claudeBinCache = c;
      _claudeBinCacheTs = now;
      return c;
    }
  }
  _claudeBinCache = "claude.cmd";
  _claudeBinCacheTs = now;
  return _claudeBinCache;
}

// UPnP-portmap: versucht beim boot das port-mapping LAN-port → WAN-port
// automatisch über UPnP zu setzen. Klappt mit ~70% der heimrouter, fallback
// = LAN-only oder ngrok.
const upnpPortmap = createUpnpPortmap({ internalPort: PORT, externalPort: PORT, timeoutMs: 4000 });
upnpPortmap.open().then((s) => {
  if (s.status === "active") {
    console.log("[upnp] aktiv: public-url =", upnpPortmap.publicUrl(),
                "ttl =", "24h (auto-refresh)");
  } else {
    console.log("[upnp] inaktiv:", s.error || "unbekannt — router-firewall blockt?");
  }
}).catch(() => {});

// Public-IP-Resolver: erkennt die externe IP via ipify/icanhazip/etc.
// Wird unabhängig von UPnP gestartet — falls user manuell port-forwarded hat,
// liefert das die IP, über die mobile direkt connecten kann.
const publicIpResolver = createPublicIpResolver();
publicIpResolver.resolve().then((r) => {
  if (r.ip) console.log("[public-ip]", r.ip, "(cached:", r.cached, ")");
  else console.log("[public-ip] unbekannt:", r.error);
}).catch(() => {});

// Cloudflare Quick-Tunnel: optional, manuell via /api/tunnel/start gestartet.
// Macht den server über internet erreichbar ohne port-forward / public-IP.
// Bei opt-in via env PG_CLOUDFLARE=1 wird der tunnel beim boot automatisch gestartet.
const cloudflareTunnel = createCloudflareTunnel({
  baseDir: __dirname,
  localPort: PORT,
  logger: console,
});
if (process.env.PG_CLOUDFLARE === "1" || process.env.PG_CLOUDFLARE === "true") {
  cloudflareTunnel.start().then((r) => {
    if (r.url) console.log("[cloudflare] auto-start tunnel:", r.url);
    else console.warn("[cloudflare] auto-start fehlgeschlagen:", r.error);
  });
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      sqliteStore.transaction(() => sqliteStore.saveState(state));
    } catch (e) {
      console.warn("[store] persist fehlgeschlagen:", e && e.message);
    }
  }, 200);
}

// Bugfix: ohne graceful shutdown ging der 200ms-debounce verloren wenn user
// das cmd-fenster schloss → frisch hinzugefügte projekte/tasks weg.
// Wir flushen jetzt synchron auf SIGINT/SIGTERM/exit.
function persistNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    sqliteStore.transaction(() => sqliteStore.saveState(state));
    console.log("[store] persist flushed before shutdown");
  } catch (e) {
    console.warn("[store] persist flush fail:", e && e.message);
  }
}

let _shuttingDown = false;
function gracefulShutdown(reason) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log("[shutdown]", reason);
  persistNow();
  try { sqliteStore.close(); } catch (_) {}
  process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGHUP", () => gracefulShutdown("SIGHUP"));
// Windows-cmd: wenn user das fenster mit X schließt, kommt CTRL_CLOSE_EVENT
// → node mappt das auf SIGHUP. Plus: bei `taskkill` kommt SIGTERM. Beides
// gedeckt. Letzte safety: beforeExit (synchroner event loop ist leer).
process.on("beforeExit", () => { if (!_shuttingDown) persistNow(); });

// Pairings & Sessions (in-memory, sessions persistieren in eigener Datei)
const SESSIONS_FILE = path.join(__dirname, "sessions.json");
let pairings = new Map(); // code -> { code, ts, expiresAt, hostName, hostId }
let sessions = new Map(); // token -> { deviceName, deviceType, since, lastSeen }

try {
  const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
  for (const [token, s] of Object.entries(raw)) {
    if (s.since + TOKEN_TTL_MS > NOW()) sessions.set(token, s);
  }
  console.log("[store] loaded sessions:", sessions.size);
} catch (e) {}

// One-time security-cleanup: vor dem patch für /api/pair/desktop-init konnte
// jeder über cloudflare-tunnel einen desktop-pair-token bekommen (isLocal-
// check wurde umgangen). Existierende desktop-pair-sessions könnten also
// fremde token sein → einmalig revoken. Marker liegt neben SESSIONS_FILE.
// Owner reloadet einmal die desktop-app + bekommt frischen token via
// localhost (jetzt strict-gated).
const TUNNEL_SECURITY_MARKER = path.join(__dirname, ".tunnel-security-fixed-v1");
if (!fs.existsSync(TUNNEL_SECURITY_MARKER)) {
  let revoked = 0;
  for (const [token, s] of sessions) {
    if (s.deviceType === "desktop" && s.pairedWith === "self") {
      sessions.delete(token);
      revoked++;
    }
  }
  if (revoked > 0) {
    persistSessionsSync();
    console.warn(`[security] tunnel-fix: revoked ${revoked} pre-patch desktop pair-session(s) — owner muss desktop einmal neu laden (localhost-pair).`);
  }
  try { fs.writeFileSync(TUNNEL_SECURITY_MARKER, String(NOW()), "utf8"); } catch (_) {}
}

function persistSessionsSync() {
  const obj = {};
  for (const [token, s] of sessions) obj[token] = s;
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), "utf8"); } catch (_) {}
}

function persistSessions() {
  const obj = {};
  for (const [token, s] of sessions) obj[token] = s;
  fs.writeFile(SESSIONS_FILE, JSON.stringify(obj, null, 2), () => {});
}

function gcPairings() {
  const t = NOW();
  for (const [code, p] of pairings) if (p.expiresAt < t) pairings.delete(code);
}
setInterval(gcPairings, 30 * 1000);

// Sessions periodisch persistieren — damit lastSeen-Werte einen Server-Restart
// überleben und keine session als „verloren" gilt.
setInterval(() => {
  if (sessions.size > 0) persistSessions();
}, 60 * 1000);

// Auto-Pump: wenn ccRunning + kein Job läuft → starte den nächsten Task
// automatisch. Reihenfolge: in_progress (höchste prio) > next (höchste prio).
// "done" und "ohne pfad" werden geskippt. Cool-down 30s pro Task gegen Loops.
const _autoPumpCooldowns = new Map(); // taskId -> ts
const _autoPumpMissingPathWarned = new Set(); // projectId -> 1× warnen statt 25s-spam
let _ccApiLimitedUntil = 0; // ts — wenn claude API limit reached, pause auto-pump bis dahin
let _dailyBudgetWarned = false; // 1× warnen statt jeden tick-spam

// Post-cc-checks-lock: solange build-gate / runtime-test / self-review für
// einen task laufen, soll autopump KEINEN neuen task auf demselben projekt
// starten. Vorher fehlte das: ccJobs.delete passierte sofort bei cc-cli-close,
// der 25s-tick pickte den nächsten task auf, retry (3s nach build-gate-fail)
// crashte mit "läuft bereits" — silent fail. Jetzt: lock bis tail komplett.
const _ccPostChecks = new Set(); // projectId — currently in build/runtime/review tail
// User-feedback: 'token-ausgabe brutal, 500k in 30min' AND 'soll nicht
// langsamer werden — sub-agents statt neue sessions'. Lösung:
//   - concurrency=1 (eine session pro projekt zur zeit — sub-agents
//     übernehmen die parallelität, nicht weitere top-level cli-spawns)
//   - cooldown 30s (war 60s, jetzt nicht langsamer als vorher)
//   - tick 10s (responsiv für nächste task wenn aktuelle done)
//   - --continue flag pro projekt → prompt-cache 5min api-side
const AUTOPUMP_COOLDOWN_MS = 30_000;
const AUTOPUMP_TICK_MS = 10_000;
const CC_RUNAWAY_LIMIT_MS = 10 * 60 * 1000; // 10min — danach killen wir runaway jobs

function _isProjectBusy(projectId) {
  return ccJobs.has(projectId) || _ccPostChecks.has(projectId);
}

// Model-routing nach Project-Gamma master-prompt:
// - sonnet-4-6 (small/fast/billig) für kleine tasks, defaultmäßig
// - opus-4-7 (groß/komplex/teuer) für architektur, refactors, große scope
// heuristik basiert auf signalen die wir LOKAL kennen (kein extra LLM-call).
// regeln: jede "big"-signatur reicht → opus. sonst → sonnet.
const BIG_KEYWORDS = /\b(refactor|rewrite|migrate|migration|architecture|architektur|umstrukturieren|umbauen|umstellen|redesign|gross|großer|großes|großen|epic|epoch|monorepo|infrastructure|infrastruktur|orchestrat|consolidate|integration|cross-cutting|breaking change|major)\b/i;
function selectModelForTask({ task, retryAttempt, prompt }) {
  // Force opus on retries — wenn sonnet 1-2× gescheitert ist, brauchen wir
  // mehr reasoning-power statt blind nochmal das gleiche zu probieren.
  if (retryAttempt && retryAttempt >= 2) return "claude-opus-4-7";
  if (!task) {
    // Manual cc-run via prompt → schätzung über prompt-länge.
    if (prompt && prompt.length > 600) return "claude-opus-4-7";
    return "claude-sonnet-4-6";
  }
  // Trivial-task-detection: kurze description + write-verb am anfang →
  // IMMER sonnet, egal wie hoch die priority. opus für „erstelle X.md mit ok"
  // ist $0.87-verbrennung mit free-form-exploration.
  const desc = (task.description || "").trim();
  const titleLower = (task.title || "").toLowerCase();
  const isTrivialWrite = desc.length < 300 &&
    /^\s*(erstelle|schreibe|lege an|create|write|f[uü]ge|add)\b/i.test(desc + " " + titleLower);
  if (isTrivialWrite) return "claude-sonnet-4-6";
  // Hohe priority (5+) → opus — ABER nur wenn die task auch wirklich
  // komplex ist (long title oder big-keywords). priority allein ist nicht
  // genug — user setzt das auch für „dringend, aber simpel" tasks.
  const haystack = (task.title || "") + " " + (task.meta || "") + " " + desc;
  const isBigByKeyword = BIG_KEYWORDS.test(haystack);
  const isBigByTitle = (task.title || "").length > 120;
  if ((task.priority || 3) >= 5 && (isBigByKeyword || isBigByTitle)) return "claude-opus-4-7";
  if (isBigByTitle) return "claude-opus-4-7";
  if (isBigByKeyword) return "claude-opus-4-7";
  return "claude-sonnet-4-6";
}

// Sofort autopump triggern (kein 25s-warten), z.b. wenn ein task gerade
// fertig wurde. Async via setTimeout(0) damit der aktuelle handler
// erstmal sauber zuende läuft.
function _triggerAutoPumpNow() {
  setTimeout(() => { autoPumpTick().catch(() => {}); }, 50);
}

// Idle-tracker für user-clients: mobile meldet idle wenn screen-off > 5min,
// desktop wenn lock/idle-event. Wenn alle bekannten clients idle melden,
// triggern wir sofort autopump (statt 25s-tick zu warten) — der user ist
// gerade nicht aktiv, also können wir die zeit für cc-jobs nutzen.
const idleTracker = createIdleTracker({ onAllIdle: _triggerAutoPumpNow });

// Failure-loop state: pro task tracken wir wie oft cc retried hat + den
// letzten fehler-output, damit der retry-prompt gezielt fixen kann statt
// blind nochmal zu versuchen.
const MAX_CC_RETRIES = 3;
const _ccRetryContext = new Map(); // taskId -> { attempt, kind, exitCode, output, projectId }

// Pure-helper: HTML-tags + entities aus activity-event-text rausschneiden,
// damit cc im prompt sauberen text bekommt statt "<i>foo</i>".
function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}
async function autoPumpTick() {
  if (!state.ccRunning) return;
  if (NOW() < _ccApiLimitedUntil) return; // claude API limit reached — warten

  // SAFETY: budget-caps. user-feedback war 500k tokens / 30min — wir
  // brauchen GRANULAREN schutz: per-hour zusätzlich zu per-day.
  // defaults: $2/hour, $10/24h. beide override-bar via state.ccBudget.
  const capHour = (state.ccBudget && state.ccBudget.hourlyCapUsd) || 2.0;
  const capDay = (state.ccBudget && state.ccBudget.dailyCapUsd) || 10.0;
  const now1h = NOW() - 60 * 60 * 1000;
  const now24h = NOW() - 24 * 60 * 60 * 1000;
  const jobs = (state.ccBudget && state.ccBudget.jobs) || [];
  const last1hCost = jobs.filter(j => j.ts >= now1h).reduce((s, j) => s + (j.costUsd || 0), 0);
  const last24hCost = jobs.filter(j => j.ts >= now24h).reduce((s, j) => s + (j.costUsd || 0), 0);

  if (last1hCost >= capHour) {
    if (!_dailyBudgetWarned) {
      _dailyBudgetWarned = true;
      console.warn(`[autopump] hourly-budget-cap: $${last1hCost.toFixed(2)} >= $${capHour.toFixed(2)} — autopump pausiert`);
      for (const project of state.projects) {
        applyMutation("ADD_ACTIVITY", { projectId: project.id, event: {
          type: "warn",
          text: `hourly-budget-cap erreicht ($${last1hCost.toFixed(2)} / $${capHour.toFixed(2)}) — autopump pausiert für 1h. settings.ccBudget.hourlyCapUsd hochsetzen falls gewollt.`,
        }});
      }
      broadcastState();
    }
    return;
  }
  if (last24hCost >= capDay) {
    if (!_dailyBudgetWarned) {
      _dailyBudgetWarned = true;
      console.warn(`[autopump] daily-budget-cap: $${last24hCost.toFixed(2)} >= $${capDay.toFixed(2)} — autopump pausiert`);
      for (const project of state.projects) {
        applyMutation("ADD_ACTIVITY", { projectId: project.id, event: {
          type: "warn",
          text: `daily-budget-cap erreicht ($${last24hCost.toFixed(2)} / $${capDay.toFixed(2)}) — autopump pausiert. Cap hochsetzen oder bis morgen warten.`,
        }});
      }
      broadcastState();
    }
    return;
  }
  _dailyBudgetWarned = false;

  // OPTIMIERUNG: über ALLE idle projekte parallel pumpen — vorher 'break'
  // nach dem ersten match → 1 task pro 10s-tick total. jetzt: pro projekt
  // 1 task parallel. für multi-projekt-users massiver durchsatz-win.
  // SAFETY: globales concurrency-limit. user-feedback war 500k tokens/30min
  // bei concurrency=3 → reduziert auf 1. Sequential statt parallel. dauert
  // länger aber kosten/zeit/token verlauf ist linear vorhersehbar.
  const MAX_CONCURRENT_CC = 1;
  if (ccJobs.size >= MAX_CONCURRENT_CC) return;
  let canStart = MAX_CONCURRENT_CC - ccJobs.size;
  for (const project of state.projects) {
    if (canStart <= 0) break;
    if (_isProjectBusy(project.id)) continue;
    if (!project.path || !fs.existsSync(project.path)) {
      if (!_autoPumpMissingPathWarned.has(project.id)) {
        _autoPumpMissingPathWarned.add(project.id);
        console.warn(`[autopump] projekt "${project.name}" (${project.id}) hat keinen gültigen pfad (path=${JSON.stringify(project.path)}) — cc wird nicht gestartet, bis ein existierender pfad gesetzt ist`);
      }
      continue;
    }
    _autoPumpMissingPathWarned.delete(project.id);

    // Erst alle in_progress (höchste prio zuerst), dann alle next (höchste prio zuerst).
    const open = (project.tasks || []).filter(t => !t.done);
    const inProgress = open.filter(t => t.group === "in_progress")
      .sort((a, b) => (b.priority || 3) - (a.priority || 3));
    const next = open.filter(t => t.group === "next")
      .sort((a, b) => (b.priority || 3) - (a.priority || 3));
    const queue = [...inProgress, ...next];

    // Ersten Kandidaten ohne aktiven Cool-down nehmen
    const candidate = queue.find(t => {
      const last = _autoPumpCooldowns.get(t.id) || 0;
      return NOW() - last > AUTOPUMP_COOLDOWN_MS;
    });
    if (!candidate) continue;
    _autoPumpCooldowns.set(candidate.id, NOW());

    console.log("[autopump] starte cc für", project.name, "·", candidate.group, "·", candidate.title);
    // Wenn Task „next" ist: erst in „in_progress" verschieben, damit das UI das zeigt.
    if (candidate.group === "next") {
      applyMutation("EDIT_TASK", { projectId: project.id, taskId: candidate.id, patch: { group: "in_progress" } });
      broadcastState();
    }
    triggerCc(project.id, candidate.id, null).catch(e => {
      console.log("[autopump] error:", e.message);
    });
    canStart--;
    // KEIN break — nächstes projekt direkt mit-pumpen (bis canStart=0).
  }
}
setInterval(autoPumpTick, AUTOPUMP_TICK_MS);

// Watchdog: kill runaway cc-jobs nach CC_RUNAWAY_LIMIT_MS (10min). Sonst
// bleibt ccJobs für immer belegt wenn claude API hängt oder eine endlos-
// schleife läuft, und autopump kann nichts mehr pumpen.
setInterval(() => {
  const now = NOW();
  for (const [pid, job] of ccJobs) {
    if (now - job.startedAt > CC_RUNAWAY_LIMIT_MS) {
      console.warn("[cc-watchdog] runaway-kill projektId=" + pid + " task=" + job.taskId + " runtime=" + Math.round((now - job.startedAt)/1000) + "s");
      // windows: claude-cli spawnt sub-prozesse (node, git, etc.) — SIGKILL
      // an top-process killt nur cmd.exe, kinder bleiben verwaist und halten
      // ggf. ports/locks. killTreeSync → taskkill /pid /T /F im windows-fall.
      killTreeSync(job.proc, { signal: "SIGKILL" });
      // ccJobs.delete passiert über on-close handler bei normalem kill
    }
  }
}, 60_000);

// Stale-lock cleanup: _ccPostChecks-locks die >15min alt sind werden
// auto-released. schützt gegen hängende build-gates / runtime-tests deren
// promise nie resolved (z.b. flutter pub get hängt, npm test deadlock).
// Sonst bleibt autopump für diesen projekt-id für immer blockiert.
const _ccPostCheckStartedAt = new Map(); // projectId -> startTs, parallel zu _ccPostChecks
const STALE_LOCK_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = NOW();
  for (const [pid, startTs] of _ccPostCheckStartedAt) {
    if (now - startTs > STALE_LOCK_MS) {
      console.warn("[cc-postcheck-watchdog] stale lock release pid=" + pid + " age=" + Math.round((now - startTs)/1000) + "s");
      _ccPostChecks.delete(pid);
      _ccPostCheckStartedAt.delete(pid);
      _triggerAutoPumpNow();
    }
  }
}, 60_000);

// Auto-answer-ticker: wenn projekt.ccAutoAnswer=true UND eine pendingQuestion
// länger als delaySec offen ist, schicken wir automatisch eine konkrete antwort
// (option-pick aus a/b/c oder rotation), DAMIT cc nicht im fragenkreis hängt.
const _autoAnsweredAt = new Map(); // projectId -> last-answered-timestamp (verhindert burst)
const _autoAnswerRotation = new Map(); // projectId -> letzte gewählte option (rotation)

// Erkennt option-listen wie "(a) X (b) Y (c) Z" oder "1. X · 2. Y · 3. Z"
// im fragetext. Liefert array von option-labels (max 8). Pure-helper.
function _extractOptions(questionText) {
  if (!questionText) return [];
  const out = [];
  // Pattern 1: (a) ..., (b) ..., (c) ... (mit klammern)
  const reA = /\(([a-zA-Z])\)\s*([^()]+?)(?=\([a-zA-Z]\)|$|,\s*[bcd]\))/g;
  let m;
  while ((m = reA.exec(questionText)) !== null && out.length < 8) {
    const label = m[2].trim().replace(/[.,;:]+$/, "");
    if (label && label.length < 200) out.push(label);
  }
  if (out.length >= 2) return out;
  // Pattern 2: "1. X 2. Y 3. Z" — nur wenn pattern 1 nichts fand
  out.length = 0;
  const reN = /\b(\d+)\.\s+([^\d][^.]*?)(?=\s+\d+\.|$)/g;
  while ((m = reN.exec(questionText)) !== null && out.length < 8) {
    const label = m[2].trim();
    if (label && label.length < 200) out.push(label);
  }
  return out;
}

async function autoAnswerTick() {
  if (!state.ccRunning) return;
  if (NOW() < _ccApiLimitedUntil) return;
  for (const project of state.projects) {
    if (!project.ccAutoAnswer) continue;
    const pq = typeof project.pendingQuestion === "string" ? project.pendingQuestion.trim() : "";
    if (!pq) continue;
    if (ccJobs.has(project.id)) continue; // läuft schon → nicht eingreifen
    const delay = Math.max(5, Math.min(600, project.ccAutoAnswerDelaySec || 30)) * 1000;
    const since = NOW() - (project.pendingQuestionAt || 0);
    if (since < delay) continue;
    // Cooldown gegen burst, falls cc gleich wieder eine frage stellt
    const lastAnswered = _autoAnsweredAt.get(project.id) || 0;
    if (NOW() - lastAnswered < 10_000) continue;
    _autoAnsweredAt.set(project.id, NOW());

    // Option-pick: wenn cc multiple-choice gestellt hat, wähle konkret eine
    // (rotation, damit der user nicht 5x dieselbe option sieht falls cc
    // dieselben fragen stellt). Sonst: explizite anweisung „entscheide selbst".
    const opts = _extractOptions(pq);
    let chosenIdx = 0;
    let answerPrompt;
    if (opts.length >= 2) {
      const lastIdx = _autoAnswerRotation.get(project.id);
      chosenIdx = typeof lastIdx === "number" ? (lastIdx + 1) % opts.length : 0;
      _autoAnswerRotation.set(project.id, chosenIdx);
      const letter = String.fromCharCode("a".charCodeAt(0) + chosenIdx);
      answerPrompt =
        `Frage von dir war:\n${pq}\n\n` +
        `AUTO-ANSWER (option ${letter}): ${opts[chosenIdx]}\n\n` +
        `Setze diese option JETZT um. Stelle KEINE weitere scope-frage; ` +
        `wenn der scope zu groß ist, zerlege ihn SELBST und arbeite am ersten ` +
        `konkreten teilschritt (max 1-2h arbeit). Liefere code + verifikation, ` +
        `nicht nur planung. done=true wenn dieser teilschritt fertig ist.`;
    } else {
      answerPrompt =
        `Frage von dir war:\n${pq}\n\n` +
        `AUTO-ANSWER: keine option vorhanden → ENTSCHEIDE SELBST und arbeite ` +
        `den ersten konkreten teilschritt ab (max 1-2h arbeit). Stelle KEINE ` +
        `weiteren rückfragen für scope-aufteilung — wenn die aufgabe groß ist, ` +
        `dann commit dich auf eine richtung und liefere code dafür. ` +
        `done=true sobald der teilschritt verifizierbar fertig ist.`;
    }

    console.log(`[auto-answer] ${project.name}: pq nach ${Math.round(since / 1000)}s` +
      (opts.length >= 2 ? ` → option ${String.fromCharCode(97+chosenIdx)}` : " → entscheide-selbst"));

    // task-kontext bewahren: triggerCc mit der task-id, an der cc beim
    // question-zeitpunkt arbeitete, NICHT mit null (was free-prompt-modus wäre)
    const taskIdForRetry = project.pendingQuestionTaskId || null;
    applyMutation("CLEAR_PENDING_QUESTION", { projectId: project.id });
    applyMutation("ADD_ACTIVITY", { projectId: project.id, event: {
      type: "info",
      text: `auto-answer (${Math.round(delay/1000)}s gewartet): ` +
        (opts.length >= 2 ? `option ${String.fromCharCode(97+chosenIdx)}` : `cc entscheidet selbst`),
    }});
    broadcastState();
    triggerCc(project.id, taskIdForRetry, answerPrompt).catch(e => console.log("[auto-answer] error:", e.message));
  }
}
setInterval(autoAnswerTick, 3 * 1000);

// 6-stelliger Code (Buchstaben + Ziffern, ohne Verwechslungsgefahr O/0/I/1/L)
function genPairingCode() {
  const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHA[crypto.randomInt(0, ALPHA.length)];
  return code;
}
function genToken() { return crypto.randomBytes(24).toString("hex"); }
function genId() { return crypto.randomBytes(8).toString("hex"); }

// ─── Mutations ──────────────────────────────────────────────
// Jede Mutation: { type, payload }. Server validiert + appliziert + persistiert + broadcastet.
const MUT = {
  PATCH_PROJECT(s, { projectId, patch }) {
    // Sicherheit: project.path landet später in spawn(..., { shell: true })
    // als cwd / --add-dir / apkPath. Shell-Metazeichen würden auf Windows
    // von cmd.exe als Befehlstrenner interpretiert (RCE-Vektor).
    if (patch && Object.prototype.hasOwnProperty.call(patch, "path") && patch.path !== "") {
      assertSafeProjectPath(patch.path, "project.path");
    }
    s.projects = s.projects.map(p => p.id === projectId ? { ...p, ...patch } : p);
  },
  // Live-Preview-Konfig: command (z.B. "npm run dev"), port (z.B. 5173),
  // url (override, sonst http://localhost:<port>). cwdRel: optional, sub-
  // ordner (z.B. "mobile-app") in dem das command gespawnt wird — sonst
  // project.path. Persistent damit der user es nicht jedesmal neu eintippt.
  SET_PREVIEW_CONFIG(s, { projectId, preview }) {
    if (!preview || typeof preview !== "object") return;
    // Sicherheit: cwdRel muss relativer pfad sein, ohne ../ und ohne
    // shell-metazeichen. landet später in spawn(cwd:...).
    let cwdRel = "";
    if (typeof preview.cwdRel === "string" && preview.cwdRel.trim()) {
      const r = preview.cwdRel.trim().replace(/\\/g, "/");
      if (!r.includes("..") && !/[<>:"|?*;&`$\n\r]/.test(r) && r.length < 200) {
        cwdRel = r;
      }
    }
    const clean = {
      command: typeof preview.command === "string" ? preview.command.slice(0, 500) : "",
      port: Number.isFinite(preview.port) ? Math.max(0, Math.min(65535, preview.port | 0)) : null,
      url: typeof preview.url === "string" ? preview.url.slice(0, 500) : "",
      cwdRel,
      autoDetected: !!preview.autoDetected,
    };
    s.projects = s.projects.map(p => p.id === projectId ? { ...p, preview: clean } : p);
  },
  ADD_PROJECT(s, { project }) {
    // Bugfix: leerer pfad ist OK (optional!), wird erst validiert wenn nicht-leer.
    // Vorher: assertSafeProjectPath warf bei "" → projekt-create scheiterte komplett.
    if (project && project.path != null && project.path !== "") {
      assertSafeProjectPath(project.path, "project.path");
    }
    if (!project.id) project.id = genId();
    project.tasks    = project.tasks    || [];
    project.rules    = project.rules    || [];
    project.ideas    = project.ideas    || [];
    project.activity = project.activity || [];
    project.goals    = project.goals    || [];
    project.files    = project.files    || [];
    // Team-collab schicht (chat / notes / appointments)
    project.messages    = project.messages    || [];
    project.notes       = project.notes       || [];
    project.appointments = project.appointments || [];
    project.lastSync = NOW();
    s.projects.push(project);
  },
  REMOVE_PROJECT(s, { projectId }) {
    s.projects = s.projects.filter(p => p.id !== projectId);
    s.syncLog  = s.syncLog.filter(e => e.projectId !== projectId);
  },
  TOGGLE_STAR(s, { projectId }) {
    s.projects = s.projects.map(p => p.id === projectId ? { ...p, starred: !p.starred } : p);
  },

  ADD_TASK(s, { projectId, task }) {
    task.id = task.id || genId();
    task.subtasks = task.subtasks || [];
    // Auto-priority falls nicht gesetzt: bei meta="hoch" → 4, "mittel" → 3, "cc-vorschlag" → 2, sonst 3
    if (typeof task.priority !== "number") {
      const m = String(task.meta || "").toLowerCase();
      task.priority = m.includes("hoch") || m.includes("urgent") ? 4
                    : m.includes("mittel") ? 3
                    : m.includes("niedrig") || m.includes("low") ? 2
                    : m.includes("cc-vorschlag") ? 3
                    : 3;
    }
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, tasks: [task, ...p.tasks] }));
  },
  SET_TASK_PRIORITY(s, { projectId, taskId, priority }) {
    const p = Math.max(1, Math.min(5, Number(priority) || 3));
    s.projects = s.projects.map(pr => pr.id !== projectId ? pr : ({
      ...pr, tasks: pr.tasks.map(t => t.id === taskId ? { ...t, priority: p } : t),
    }));
  },
  MOVE_TASK_PRIORITY(s, { projectId, taskId, delta }) {
    const d = Math.sign(Number(delta) || 0);
    s.projects = s.projects.map(pr => pr.id !== projectId ? pr : ({
      ...pr, tasks: pr.tasks.map(t => {
        if (t.id !== taskId) return t;
        const cur = typeof t.priority === "number" ? t.priority : 3;
        return { ...t, priority: Math.max(1, Math.min(5, cur + d)) };
      }),
    }));
  },
  TOGGLE_TASK(s, { projectId, taskId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, tasks: p.tasks.map(t => {
        if (t.id !== taskId) return t;
        const done = !t.done;
        return { ...t, done, group: done ? "done" : (t.group === "done" ? "next" : t.group) };
      }),
    }));
  },
  // Idempotenter set-done — cc-pipeline benutzt das statt TOGGLE_TASK um
  // race-condition zu vermeiden: wenn user task manuell schon abgehakt
  // hatte während cc lief, würde TOGGLE_TASK ihn zurück auf 'offen' setzen.
  SET_TASK_DONE(s, { projectId, taskId, done }) {
    const target = !!done;
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, tasks: p.tasks.map(t => {
        if (t.id !== taskId) return t;
        if (t.done === target) return t; // no-op
        return { ...t, done: target, group: target ? "done" : (t.group === "done" ? "next" : t.group) };
      }),
    }));
  },
  REMOVE_TASK(s, { projectId, taskId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, tasks: p.tasks.filter(t => t.id !== taskId) }));
  },
  EDIT_TASK(s, { projectId, taskId, patch }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t),
    }));
  },
  ADD_SUBTASK(s, { projectId, taskId, subtask }) {
    subtask.id = subtask.id || genId();
    subtask.done = !!subtask.done;
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, tasks: p.tasks.map(t => t.id !== taskId ? t : ({ ...t, subtasks: [...t.subtasks, subtask] })),
    }));
  },
  TOGGLE_SUBTASK(s, { projectId, taskId, subtaskId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, tasks: p.tasks.map(t => t.id !== taskId ? t : ({
        ...t, subtasks: t.subtasks.map(st => st.id === subtaskId ? { ...st, done: !st.done } : st),
      })),
    }));
  },
  REMOVE_SUBTASK(s, { projectId, taskId, subtaskId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, tasks: p.tasks.map(t => t.id !== taskId ? t : ({
        ...t, subtasks: t.subtasks.filter(st => st.id !== subtaskId),
      })),
    }));
  },

  ADD_RULE(s, { projectId, rule }) {
    rule.id = rule.id || genId();
    rule.active = rule.active !== false;
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, rules: [...p.rules, rule] }));
  },
  TOGGLE_RULE(s, { projectId, ruleId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, rules: p.rules.map(r => r.id === ruleId ? { ...r, active: !r.active } : r),
    }));
  },
  REMOVE_RULE(s, { projectId, ruleId }) {
    // Removed-rules in ein kleines Tombstone-Log schreiben, damit
    // cloud-code im prompt sehen kann, was der user kürzlich entfernt
    // hat — verhindert „immer wieder dieselbe regel vorschlagen".
    // Zusätzlich activity-event, damit der user die änderung in der UI sieht.
    s.projects = s.projects.map(p => {
      if (p.id !== projectId) return p;
      const removed = p.rules.find(r => r.id === ruleId);
      const tomb = (p.removedRules || []).slice(0, 19);
      if (removed) tomb.unshift({ text: removed.text, ts: NOW() });
      const activityEvt = removed ? [{
        id: genId(), ts: NOW(), type: "rule",
        text: "regel entfernt: <i>" + escapeHtml(removed.text) + "</i>",
      }] : [];
      return {
        ...p,
        rules: p.rules.filter(r => r.id !== ruleId),
        removedRules: tomb,
        activity: [...activityEvt, ...(p.activity || [])].slice(0, 200),
      };
    });
  },
  EDIT_RULE(s, { projectId, ruleId, text }) {
    s.projects = s.projects.map(p => {
      if (p.id !== projectId) return p;
      const before = p.rules.find(r => r.id === ruleId);
      const beforeText = before ? before.text : "";
      const activityEvt = before && beforeText !== text ? [{
        id: genId(), ts: NOW(), type: "rule",
        text: "regel geändert: <i>" + escapeHtml(beforeText) + "</i> → <i>" + escapeHtml(text) + "</i>",
      }] : [];
      return {
        ...p,
        rules: p.rules.map(r => r.id === ruleId ? { ...r, text } : r),
        activity: [...activityEvt, ...(p.activity || [])].slice(0, 200),
      };
    });
  },

  // Cloud-Code activate/deactivate-Vorschläge landen hier — nicht direkt
  // als TOGGLE_RULE. User bestätigt via APPROVE_RULE_DIFF / REJECT_RULE_DIFF.
  ENQUEUE_RULE_DIFFS(s, { projectId, suggestion }) {
    s.projects = s.projects.map(p => {
      if (p.id !== projectId) return p;
      const diffs = ruleDiffQueue.buildDiffs(p, suggestion, { now: NOW, genId });
      if (!diffs.length) return p;
      return ruleDiffQueue.enqueue(p, diffs);
    });
  },
  APPROVE_RULE_DIFF(s, { projectId, diffId }) {
    s.projects = s.projects.map(p => {
      if (p.id !== projectId) return p;
      return ruleDiffQueue.approveDiff(p, diffId).project;
    });
  },
  REJECT_RULE_DIFF(s, { projectId, diffId }) {
    s.projects = s.projects.map(p => {
      if (p.id !== projectId) return p;
      return ruleDiffQueue.rejectDiff(p, diffId).project;
    });
  },

  ADD_IDEA(s, { projectId, idea }) {
    idea.id = idea.id || genId();
    idea.status = idea.status || "unprocessed";
    idea.createdAt = idea.createdAt || NOW();
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, ideas: [idea, ...p.ideas] }));
  },
  CONVERT_IDEA(s, { projectId, ideaId, title, meta, priority }) {
    // Optionale Overrides (title/meta/priority) ermoeglichen 1-Tap-Accept
    // eines KI-Vorschlags inline aus der Idee-Liste. Fehlen sie, gilt das
    // alte Verhalten: text 1:1 als title, meta "aus idee".
    let ideaText = null;
    s.projects = s.projects.map(p => {
      if (p.id !== projectId) return p;
      const idea = p.ideas.find(i => i.id === ideaId);
      if (!idea) return p;
      ideaText = idea.text;
      const newTask = {
        id: genId(),
        title: (typeof title === "string" && title.trim()) ? title.trim() : idea.text,
        done: false,
        group: "next",
        meta: (typeof meta === "string" && meta.trim()) ? meta.trim() : "aus idee",
        subtasks: [],
      };
      if (typeof priority === "number" && priority >= 1 && priority <= 5) {
        newTask.priority = priority;
      }
      return {
        ...p,
        tasks: [newTask, ...p.tasks],
        ideas: p.ideas.map(i => i.id === ideaId ? { ...i, status: "task_created" } : i),
      };
    });
    return ideaText;
  },
  DISMISS_IDEA(s, { projectId, ideaId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, ideas: p.ideas.map(i => i.id === ideaId ? { ...i, status: "processed" } : i),
    }));
  },
  REACTIVATE_IDEA(s, { projectId, ideaId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, ideas: p.ideas.map(i => i.id === ideaId ? { ...i, status: "unprocessed" } : i),
    }));
  },
  REMOVE_IDEA(s, { projectId, ideaId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, ideas: p.ideas.filter(i => i.id !== ideaId) }));
  },
  EDIT_IDEA(s, { projectId, ideaId, text }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, ideas: p.ideas.map(i => i.id === ideaId ? { ...i, text } : i),
    }));
  },

  SET_GOALS(s, { projectId, goals }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, goals }));
  },
  SET_FILES(s, { projectId, files }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, files }));
  },

  ADD_ACTIVITY(s, { projectId, event }) {
    event.id = event.id || genId();
    event.ts = event.ts || NOW();
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, activity: [event, ...p.activity].slice(0, 200),
    }));
  },
  CLEAR_ACTIVITY(s, { projectId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, activity: [] }));
  },
  SET_PENDING_QUESTION(s, { projectId, question, taskId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, pendingQuestion: String(question || "").slice(0, 1000),
      pendingQuestionAt: NOW(),
      pendingQuestionTaskId: taskId || null, // damit auto-answer den task-kontext kennt
    }));
  },
  CLEAR_PENDING_QUESTION(s, { projectId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, pendingQuestion: null, pendingQuestionAt: null, pendingQuestionTaskId: null,
    }));
  },
  // Auto-answer-mode: wenn an, beantwortet der server pendingQuestions
  // automatisch nach N sekunden mit "decide yourself and continue".
  // Per-projekt persistiert (user kann pro projekt entscheiden).
  TOGGLE_CC_AUTO_ANSWER(s, { projectId, on, delaySec }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p,
      ccAutoAnswer: typeof on === "boolean" ? on : !p.ccAutoAnswer,
      ccAutoAnswerDelaySec: Math.max(5, Math.min(600, Number(delaySec) || p.ccAutoAnswerDelaySec || 30)),
    }));
  },
  ADD_SYNC_LOG(s, { entry }) {
    entry.id = entry.id || genId();
    entry.ts = entry.ts || NOW();
    s.syncLog = [entry, ...s.syncLog].slice(0, 500);
  },
  CLEAR_SYNC_LOG(s, { projectId }) {
    s.syncLog = projectId ? s.syncLog.filter(e => e.projectId !== projectId) : [];
  },
  DO_SYNC(s) {
    s.lastFullSync = NOW();
    s.projects = s.projects.map(p => ({ ...p, lastSync: NOW() }));
  },
  TOGGLE_CC(s, { running }) {
    s.ccRunning = !!running;
  },

  // budget-caps direkt am ccBudget-state setzen. wert null oder 0 = unbegrenzt
  // (der check oben in budget-guard nimmt 'value || 2.0' default — daher 0
  // wirkt wie unbegrenzt via null-coalescing kette).
  SET_CC_BUDGET_CAPS(s, { hourlyCapUsd, dailyCapUsd, perTaskUsd }) {
    if (!s.ccBudget) s.ccBudget = { totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, jobs: [] };
    if (hourlyCapUsd !== undefined) {
      const v = Number(hourlyCapUsd);
      s.ccBudget.hourlyCapUsd = Number.isFinite(v) && v > 0 ? v : 999999;
    }
    if (dailyCapUsd !== undefined) {
      const v = Number(dailyCapUsd);
      s.ccBudget.dailyCapUsd = Number.isFinite(v) && v > 0 ? v : 999999;
    }
    if (perTaskUsd !== undefined) {
      const v = Number(perTaskUsd);
      s.ccBudget.perTaskUsd = Number.isFinite(v) && v > 0 ? v : 999;
    }
  },

  // ─── Vorschläge ─────────────────────────────────────────
  ADD_SUGGESTION(s, { projectId, suggestion }) {
    suggestion.id = suggestion.id || genId();
    suggestion.ts = suggestion.ts || NOW();
    suggestion.status = suggestion.status || "pending";
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, suggestions: [suggestion, ...(p.suggestions || [])].slice(0, 50),
    }));
  },
  SET_SUGGESTION_STATUS(s, { projectId, suggestionId, status }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, suggestions: (p.suggestions || []).map(x => x.id === suggestionId ? { ...x, status } : x),
    }));
  },
  REMOVE_SUGGESTION(s, { projectId, suggestionId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, suggestions: (p.suggestions || []).filter(x => x.id !== suggestionId),
    }));
  },

  // ─── Bug-Hunt ───────────────────────────────────────────
  ADD_BUG(s, { projectId, bug }) {
    bug.id = bug.id || genId();
    bug.ts = bug.ts || NOW();
    bug.status = bug.status || "pending";
    s.projects = s.projects.map(p => {
      if (p.id !== projectId) return p;
      // FIX #6: dedup nur wenn BEIDE seiten description haben.
      // Vorher: undef===undef → wahr → alle bugs ohne description wurden geschluckt.
      const newDescr = (bug.description || "").trim().toLowerCase();
      const newLoc = (bug.location || "").trim();
      const existing = (p.bugs || []).find(b => {
        if (b.status === "resolved") return false;
        const bDescr = (b.description || "").trim().toLowerCase();
        const bLoc = (b.location || "").trim();
        // Match 1: exact description (beide nicht-leer)
        if (newDescr && bDescr && newDescr === bDescr) return true;
        // Match 2: gleiche location + ähnlicher description-anfang
        if (newLoc && bLoc && newLoc === bLoc && newDescr && bDescr) {
          if (newDescr.slice(0, 40) === bDescr.slice(0, 40)) return true;
        }
        return false;
      });
      if (existing) return p; // skip duplicate
      return { ...p, bugs: [bug, ...(p.bugs || [])].slice(0, 100) };
    });
  },
  SET_BUG_STATUS(s, { projectId, bugId, status }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, bugs: (p.bugs || []).map(x => x.id === bugId ? { ...x, status } : x),
    }));
  },
  REMOVE_BUG(s, { projectId, bugId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, bugs: (p.bugs || []).filter(x => x.id !== bugId),
    }));
  },
  TOGGLE_BUG_AUTO_FIX(s, { projectId, on }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({ ...p, bugAutoFix: !!on }));
  },

  // ─── Team-collab: chat / notes / appointments ─────────────
  // author/authorEmail füllt der server aus session-ctx, damit user nicht
  // beliebig „spoofed" verschicken können (siehe applyMutation-wrapper).
  ADD_MESSAGE(s, { projectId, message }) {
    // Mentions parsen: @user@email.de oder @email — extract liste, server
    // emittet daraus push-notifications nach mutation (siehe applyMutation-wrapper).
    const rawText = String(message.text || "").slice(0, 4000);
    const mentionRx = /@([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const mentions = [];
    let mm;
    while ((mm = mentionRx.exec(rawText)) !== null) mentions.push(mm[1].toLowerCase());
    const m = {
      id: message.id || genId(),
      ts: message.ts || NOW(),
      author: message.author || null,        // userId oder deviceName
      authorEmail: message.authorEmail || null,
      text: rawText,
      mentions: mentions.length ? mentions : null,
      // Optional: bild-/file-anhang. {url, name, kind:'image'|'file', size}.
      attachment: (message.attachment && typeof message.attachment === "object")
        ? {
            url: String(message.attachment.url || "").slice(0, 500),
            name: String(message.attachment.name || "").slice(0, 200),
            kind: ["image", "file"].includes(message.attachment.kind) ? message.attachment.kind : "file",
            size: Number(message.attachment.size) || 0,
          }
        : null,
    };
    // Mind. text ODER attachment vorhanden — beides leer = skip
    if (!m.text.trim() && !m.attachment) return;
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, messages: [...(p.messages || []), m].slice(-500),
    }));
  },
  REMOVE_MESSAGE(s, { projectId, messageId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, messages: (p.messages || []).filter(m => m.id !== messageId),
    }));
  },

  ADD_NOTE(s, { projectId, note }) {
    const n = {
      id: note.id || genId(),
      ts: note.ts || NOW(),
      updatedAt: note.ts || NOW(),
      author: note.author || null,
      authorEmail: note.authorEmail || null,
      title: String(note.title || "").slice(0, 200),
      body: String(note.body || "").slice(0, 20000),
    };
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, notes: [n, ...(p.notes || [])].slice(0, 200),
    }));
  },
  EDIT_NOTE(s, { projectId, noteId, patch }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, notes: (p.notes || []).map(n => n.id !== noteId ? n : ({
        ...n,
        ...(patch.title !== undefined ? { title: String(patch.title).slice(0, 200) } : {}),
        ...(patch.body !== undefined ? { body: String(patch.body).slice(0, 20000) } : {}),
        updatedAt: NOW(),
      })),
    }));
  },
  REMOVE_NOTE(s, { projectId, noteId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, notes: (p.notes || []).filter(n => n.id !== noteId),
    }));
  },

  ADD_APPOINTMENT(s, { projectId, appointment }) {
    const a = {
      id: appointment.id || genId(),
      ts: appointment.ts || NOW(),
      author: appointment.author || null,
      authorEmail: appointment.authorEmail || null,
      title: String(appointment.title || "").slice(0, 200),
      when: String(appointment.when || ""), // ISO-string, UI-validiert
      durationMin: Number(appointment.durationMin) || 30,
      notes: String(appointment.notes || "").slice(0, 2000),
      attendees: Array.isArray(appointment.attendees) ? appointment.attendees.slice(0, 50) : [],
    };
    if (!a.title.trim() || !a.when) return;
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, appointments: [...(p.appointments || []), a].slice(-200),
    }));
  },
  EDIT_APPOINTMENT(s, { projectId, appointmentId, patch }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, appointments: (p.appointments || []).map(a => a.id !== appointmentId ? a : ({
        ...a,
        ...(patch.title !== undefined ? { title: String(patch.title).slice(0, 200) } : {}),
        ...(patch.when !== undefined ? { when: String(patch.when) } : {}),
        ...(patch.durationMin !== undefined ? { durationMin: Number(patch.durationMin) || 30 } : {}),
        ...(patch.notes !== undefined ? { notes: String(patch.notes).slice(0, 2000) } : {}),
      })),
    }));
  },
  REMOVE_APPOINTMENT(s, { projectId, appointmentId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, appointments: (p.appointments || []).filter(a => a.id !== appointmentId),
    }));
  },
  TOGGLE_APPOINTMENT_RSVP(s, { projectId, appointmentId, attendee }) {
    if (!attendee) return;
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, appointments: (p.appointments || []).map(a => {
        if (a.id !== appointmentId) return a;
        const set = new Set(a.attendees || []);
        if (set.has(attendee)) set.delete(attendee); else set.add(attendee);
        return { ...a, attendees: Array.from(set) };
      }),
    }));
  },
};

function applyMutation(type, payload, ctx) {
  const fn = MUT[type];
  if (!fn) throw new Error("unknown mutation: " + type);
  // Team-collab: author/authorEmail kommt IMMER vom server aus session-ctx —
  // niemals aus client-payload. Sonst könnten user als andere posten.
  if (payload && (type === "ADD_MESSAGE" || type === "ADD_NOTE" || type === "ADD_APPOINTMENT")) {
    const sub = type === "ADD_MESSAGE" ? "message" : type === "ADD_NOTE" ? "note" : "appointment";
    const obj = payload[sub] || {};
    const sess = ctx && ctx.session;
    if (sess) {
      obj.author = sess.userId || ("device:" + (sess.deviceName || "anon"));
      obj.authorEmail = sess.userId ? sess.deviceName : null; // bei user-sess = email; bei device-sess = null
    } else {
      obj.author = "server";
      obj.authorEmail = null;
    }
    payload[sub] = obj;
  }
  fn(state, payload || {}, ctx);
  // Kritische mutations sofort flushen (nicht 200ms debounced), damit
  // bei kurz darauf shutdown (user schließt fenster) nichts verloren geht.
  const CRITICAL = ["ADD_PROJECT", "REMOVE_PROJECT", "PATCH_PROJECT"];
  if (CRITICAL.includes(type)) {
    try {
      clearTimeout(saveTimer); saveTimer = null;
      sqliteStore.transaction(() => sqliteStore.saveState(state));
    } catch (e) { console.warn("[store] sync persist fail:", e && e.message); }
  } else {
    persist();
  }
  // Schicht 3: append zu op_log + OP_APPEND broadcast. Best-effort, kein
  // throw nach außen — die mutation selbst ist die source-of-truth.
  try { recordAndBroadcastOp(type, payload, ctx); } catch (e) {
    console.warn("[op_log] record fehlgeschlagen:", e && e.message);
  }
  // Push bei @mentions im chat: notification an gemeinten user.
  try {
    if (type === "ADD_MESSAGE" && payload && payload.message) {
      const proj = state.projects.find(p => p.id === payload.projectId);
      // Optional-chain + .at(-1): safe wenn messages fehlt oder leer.
      const lastMsg = proj?.messages?.at(-1) ?? null;
      if (lastMsg && Array.isArray(lastMsg.mentions) && lastMsg.mentions.length > 0) {
        emitPush({
          type: "chat_mention",
          projectId: payload.projectId,
          mentions: lastMsg.mentions,
          author: lastMsg.authorEmail || lastMsg.author,
          preview: lastMsg.text.slice(0, 120),
        });
      }
    }
  } catch (e) { /* best-effort */ }
}

// deviceId aus session ableiten — stabil über reconnects.
// Pair-session: deviceName. User-session: userId. Intern: 'server'.
function _deviceIdFromCtx(ctx) {
  const s = ctx && ctx.session;
  if (!s) return "server";
  if (s.userId) return "user:" + s.userId;
  return "device:" + (s.deviceName || "anon");
}

// Mutations, die KEINE projektspezifischen state-änderungen sind, gehen
// NICHT ins op_log (würden den log für reconnect-resync nur verrauschen).
const _NON_PROJECT_MUTATIONS = new Set([
  "ADD_SYNC_LOG", "CLEAR_SYNC_LOG", "DO_SYNC", "TOGGLE_CC",
]);

function _projectIdForOp(type, payload) {
  if (_NON_PROJECT_MUTATIONS.has(type)) return null;
  if (type === "ADD_PROJECT") {
    // payload.project ist dieselbe object-ref, die MUT.ADD_PROJECT in
    // state.projects gepusht hat — id ist inline gesetzt (siehe MUT.ADD_PROJECT).
    // Race-fix: state.projects[length-1] ist bei parallelen ADD_PROJECT
    // fragil und kann auf ein anderes gleichzeitig angelegtes projekt zeigen.
    const created = payload && payload.project;
    return created && created.id ? created.id : null;
  }
  if (type === "REMOVE_PROJECT") return payload && payload.projectId;
  return (payload && payload.projectId) || null;
}

function recordAndBroadcastOp(type, payload, ctx) {
  if (!opLogStore) return;
  const projectId = _projectIdForOp(type, payload);
  if (!projectId) return;
  const deviceId = _deviceIdFromCtx(ctx);
  const opId = "op_" + Date.now().toString(36) + "_" +
    crypto.randomBytes(4).toString("hex");
  const op = opLogStore.appendOp(projectId, {
    opId, deviceId, type, payload: payload || {}, ts: NOW(),
  });
  const frame = buildOpAppendFrame(projectId, op);
  // wss kann zur boot-zeit noch undefined sein (frühe state-mutations);
  // dann nur loggen, kein broadcast.
  if (typeof wss === "undefined" || !wss || !wss.clients) return;
  const data = JSON.stringify(frame);
  // Fix C · membership-filter: pair-tokens (kein userId) sehen alles (legacy).
  // user-tokens sehen OP_APPEND nur wenn sie membership im projekt haben.
  // Vorher: jeder client kriegte ALLE ops aller projekte → spam.
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const sess = client._session;
    if (sess && sess.userId && memberships) {
      const role = memberships.getRole(projectId, sess.userId);
      if (!role) continue; // kein zugriff, kein broadcast
    }
    try { client.send(data); } catch (_) {}
  }
}

// ─── HTTP-Layer ─────────────────────────────────────────────
const app = express();
app.use(cors());
// json-body-limit hoch: 8 MB für base64-attachments (bilder)
app.use(express.json({ limit: "8mb" }));

// Desktop-App static serving — damit der user keinen zusätzlichen
// python/npx http-server braucht. Wenn `../desktop-app/index.html` existiert,
// werden die JSX/CSS/JS aus diesem ordner direkt vom sync-server serviert.
// → start.bat braucht jetzt nur node, keine zweite runtime.
const DESKTOP_APP_DIR = path.join(__dirname, "..", "desktop-app");
const desktopUiAvailable = fs.existsSync(path.join(DESKTOP_APP_DIR, "index.html"));
if (desktopUiAvailable) {
  // no-cache headers — sonst zeigt browser nach update.bat noch alte JS/CSS
  // weil chrome ohne expliziten cache-bust JS-files aggressiv cached.
  // mit 'no-cache' lädt browser bei jedem reload neu (revalidation per
  // ETag) — bandwidth-overhead ist minimal weil 304 zurückkommt wenn
  // sich nichts geändert hat. team-clients sehen update beim nächsten F5.
  app.use(express.static(DESKTOP_APP_DIR, {
    index: "index.html",
    extensions: ["html"],
    setHeaders: (res, p) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    },
  }));
  console.log("[ui] desktop-app static serving von", DESKTOP_APP_DIR);
} else {
  console.log("[ui] desktop-app folder nicht gefunden — static serving deaktiviert");
}

// Fallback-root: wenn nicht statisch verfügbar, klare API-info statt 404.
app.get("/", (req, res, next) => {
  if (desktopUiAvailable) return next();
  const wantsHtml = String(req.headers.accept || "").includes("text/html");
  if (wantsHtml) {
    const host = (req.headers.host || "").split(":")[0] || "localhost";
    return res.redirect(302, `http://${host}:7891/index.html`);
  }
  res.json({
    service: "projectgamma-sync-server",
    port: PORT,
    desktopUiPort: 7891,
    endpoints: ["/health", "/api/network-info", "/api/pair/init", "/api/pair/claim", "/ws"],
  });
});

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    ts: NOW(),
    sessions: sessions.size,
    pairings: pairings.size,
    projects: state.projects.length,
    // isLocal: false → der client erreicht den server über tunnel/FQDN, NICHT
    // direkt über localhost/LAN. BootPairing darf dann KEIN auto-selfInit
    // versuchen (würde 403 geben) → user muss team-beitreten wählen.
    isLocal: isLocalRequest(req),
  });
});

// Netzwerk-Info: liefert alle möglichen connect-routen, damit mobile-clients
// auswählen können — LAN-IPs, UPnP-public, manuelle public-IP.
// Bugfix (audit): LAN-IPs nach „realistic home-WLAN range" sortieren —
// häufige VPN-/zerotier-adapter (z.B. 192.168.66.x, 25.x) sind nicht das
// heim-WLAN auf das mobile sich verbindet → ans ende.
function _rankLanIp(ip) {
  // Höher = wahrscheinlicher das echte heim-WLAN
  if (/^192\.168\.(0|1|178|2)\./.test(ip)) return 100;  // typische fritzbox/router
  if (/^192\.168\./.test(ip)) return 50;                 // andere 192.168
  if (/^10\.0\.0\./.test(ip)) return 40;                 // home-LAN-variante
  if (/^10\./.test(ip)) return 30;                       // andere 10er
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return 20; // 172.16-31
  return 10;
}
// Setup-check: erste user merken sofort wenn deps fehlen. Public-endpoint
// (kein auth) damit UI vor pairing pingen kann. Resultat wird 30s gecached
// damit der UI-poll nicht jede prüfung erneut spawned (~1s pro check).
let _setupCache = null;
let _setupCacheTs = 0;
const SETUP_CACHE_MS = 30 * 1000;
app.get("/api/setup-check", async (req, res) => {
  const force = req.query.force === "1";
  const now = NOW();
  if (!force && _setupCache && (now - _setupCacheTs) < SETUP_CACHE_MS) {
    return res.json({ ...{}, ..._setupCache, cached: true });
  }
  try {
    const result = await runSetupCheck({ baseDir: path.resolve(__dirname, "..") });
    _setupCache = result;
    _setupCacheTs = now;
    res.json({ ...result, cached: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/network-info", (req, res) => {
  const ifaces = require("os").networkInterfaces();
  const lanIps = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list) if (i.family === "IPv4" && !i.internal) lanIps.push(i.address);
  }
  lanIps.sort((a, b) => _rankLanIp(b) - _rankLanIp(a));
  // Public-route-optionen, in präferenz-reihenfolge.
  const routes = [];
  // 1. Cloudflare-Tunnel (https, hinter NAT/CGNAT erreichbar) — wenn aktiv die
  //    zuverlässigste route, daher first.
  const cf = cloudflareTunnel.getStatus();
  if (cf.status === "active" && cf.url) {
    routes.push({ kind: "cloudflare", url: cf.url, public: true, scheme: "wss" });
  }
  // 2. UPnP-public (router hat port-mapping automatisch gesetzt)
  const upnp = upnpPortmap.getStatus();
  if (upnp.status === "active" && upnp.externalIp) {
    routes.push({ kind: "upnp", url: "http://" + upnp.externalIp + ":" + PORT, public: true });
  }
  // 3. manueller port-forward (server kennt seine public-IP, port-status
  //    nicht garantiert — mobile testet selbst via /health)
  const pubIp = publicIpResolver.getCached();
  if (pubIp.ip && !routes.find((r) => r.url.includes(pubIp.ip))) {
    routes.push({ kind: "public-ip", url: "http://" + pubIp.ip + ":" + PORT, public: true, needsPortForward: true });
  }
  // 4. LAN-IPs (jeweils einzeln, schnell wenn beide im selben netz)
  for (const ip of lanIps) {
    routes.push({ kind: "lan", url: "http://" + ip + ":" + PORT, public: false });
  }
  res.json({ port: PORT, ips: lanIps, routes, tunnel: cf });
});

// Cloudflare Tunnel control — desktop-pair-session ODER user-account mit
// owner-rolle in mindestens einem projekt (server-administration darf nur,
// wer auch lokal oder als account-admin auf dem server registriert ist —
// `/api/auth/register` ist beim ersten user localhost-gated).
function _canControlTunnel(session) {
  if (!session) return false;
  if (isDesktopSession(session)) return true;
  // user-token: owner irgendeines projekts?
  if (session.userId && memberships) {
    const list = memberships.listProjectsForUser(session.userId) || [];
    return list.some(m => m.role === ROLES.OWNER);
  }
  return false;
}
app.post("/api/tunnel/start", authMw, async (req, res) => {
  if (!_canControlTunnel(req.session)) return res.status(403).json({ error: "desktop-session oder owner-account erforderlich" });
  const r = await cloudflareTunnel.start();
  res.json(r);
});
app.post("/api/tunnel/stop", authMw, (req, res) => {
  if (!_canControlTunnel(req.session)) return res.status(403).json({ error: "desktop-session oder owner-account erforderlich" });
  const r = cloudflareTunnel.stop();
  res.json(r);
});
app.get("/api/tunnel/status", (req, res) => {
  res.json(cloudflareTunnel.getStatus());
});

// Pair init: Desktop ruft auf → bekommt 6-stelligen Code zurück.
// Devices die diesen Code kennen können claim aufrufen und Session bekommen.
app.post("/api/pair/init", (req, res) => {
  gcPairings();
  const hostName = (req.body && req.body.deviceName) || "desktop";
  const code = genPairingCode();
  const expiresAt = NOW() + PAIRING_TTL_MS;
  pairings.set(code, { code, expiresAt, hostName, ts: NOW() });
  console.log("[pair] init code:", code, "host:", hostName);
  // QR-Payload: kompakter String, Mobile-App parst host+port+code aus URL.
  // Schema-priorität:
  //   1. Cloudflare-tunnel (aktiv) → host=<tunnel-host>, port=443, scheme=wss
  //      → mobile verbindet sich übers internet ohne LAN/port-forward.
  //   2. Sonst: LAN-IP/UPnP-IP — host wird nicht hardcoded, mobile probiert
  //      die alt-hosts aus dem `hosts`-array durch.
  const fp = TLS_INFO.fingerprint;
  const pubIp = publicIpResolver.getCached().ip;
  const cf = cloudflareTunnel.getStatus();
  let scheme = TLS_INFO.mode === "off" ? "ws" : "wss";
  let hostQ = "";
  let portQ = `&port=${PORT}`;
  if (cf.status === "active" && cf.url) {
    // cloudflare gibt uns eine https://<random>.trycloudflare.com — host extrahieren.
    const m = cf.url.match(/^https:\/\/([^/]+)/i);
    if (m) {
      hostQ = `&host=${m[1]}`;
      scheme = "wss";
      portQ = "&port=443";
    }
  }
  const fpQ = fp ? `&fp=${fp}` : "";
  const pubQ = pubIp ? `&pub=${pubIp}` : "";
  const qrPayload = `pgamma://pair?${portQ.slice(1)}&code=${code}&scheme=${scheme}${hostQ}${fpQ}${pubQ}`;
  res.json({
    code, expiresAt, qrPayload,
    certFingerprint: fp, tlsMode: TLS_INFO.mode,
    publicIp: pubIp || null,
    tunnel: cf,
  });
});

// Helper: prüft ob ein Request WIRKLICH vom localhost kommt — nicht nur per
// socket-IP, sondern auch per host-header. Sonst kann ein cloudflare-tunnel
// (cloudflared läuft auf dem server und forwarded an 127.0.0.1) den localhost-
// gate umgehen: socket-IP wäre 127.0.0.1, aber der originale request kam aus
// dem internet. Verifiziert: über tunnel war /api/pair/desktop-init aufrufbar
// und gab pair-tokens mit vollzugriff aus.
function isLocalRequest(req) {
  const ip = req.ip || req.connection?.remoteAddress || "";
  const ipIsLocal =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.");
  if (!ipIsLocal) return false;
  // host-header muss localhost oder eine LAN-IP sein. Tunnel-hostnames
  // (*.trycloudflare.com, *.ngrok.io, eigene FQDNs) → block.
  const host = (req.hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
  );
}

// Desktop-Self-Init: nur über localhost erreichbar, erzeugt Desktop-Session
// ohne Pairing-Code (Desktop ist Trust-Boundary). Idempotent: wenn schon eine
// Desktop-Session mit gleichem Namen existiert, wird der bestehende Token zurückgegeben.
app.post("/api/pair/desktop-init", (req, res) => {
  if (!isLocalRequest(req)) {
    console.warn("[pair] desktop-init blocked: non-local request host=" + req.hostname + " ip=" + req.ip);
    return res.status(403).json({ error: "nur lokal erreichbar — für team-collab nutze account-login (team beitreten)" });
  }

  const deviceName = (req.body && req.body.deviceName) || "desktop";

  // Reuse existing desktop-session if present
  for (const [token, s] of sessions) {
    if (s.deviceType === "desktop" && s.deviceName === deviceName) {
      s.lastSeen = NOW();
      persistSessions();
      return res.json({ token, deviceName, since: s.since, reused: true });
    }
  }

  const token = genToken();
  sessions.set(token, { deviceName, deviceType: "desktop", since: NOW(), lastSeen: NOW(), pairedWith: "self" });
  persistSessions();
  console.log("[pair] desktop-init:", deviceName);
  res.json({ token, deviceName, since: NOW(), reused: false });
});

// Pair claim: Mobile sendet Code → bekommt Session-Token zurück.
// deviceType wird hier IMMER auf "mobile" gesetzt: claim ist mobile-only
// (desktop nutzt /api/pair/desktop-init, localhost-gated). Würde der body
// "desktop" senden, bekäme ein mobile-client sonst desktop-rechte
// (alle tokens lesen, fremde sessions löschen).
app.post("/api/pair/claim", (req, res) => {
  gcPairings();
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const gate = claimRateLimiter.check(ip);
  if (!gate.allowed) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({ error: "zu viele versuche, später erneut probieren", retryAfterSec: gate.retryAfterSec });
  }
  const code = String((req.body && req.body.code) || "").trim().toUpperCase();
  const deviceName = (req.body && req.body.deviceName) || "mobile";
  const deviceType = normalizeClaimDeviceType();
  if (!code) {
    claimRateLimiter.recordFailure(ip);
    return res.status(400).json({ error: "code fehlt" });
  }
  const p = pairings.get(code);
  if (!p) {
    claimRateLimiter.recordFailure(ip);
    return res.status(404).json({ error: "code unbekannt oder abgelaufen" });
  }

  const token = genToken();
  sessions.set(token, { deviceName, deviceType, since: NOW(), lastSeen: NOW(), pairedWith: p.hostName });
  pairings.delete(code); // 1× verwendbar
  persistSessions();

  console.log("[pair] claim ok:", deviceName, "(", deviceType, ") via code", code);

  // Sync-Log Eintrag und Broadcast
  applyMutation("ADD_SYNC_LOG", { entry: {
    source: deviceType,
    text: `gerät verbunden: <i>${escapeHtml(deviceName)}</i>`,
    projectId: state.projects[0]?.id || null,
  }});
  broadcastState();

  res.json({ token, deviceName, since: NOW() });
});

// ─── Multi-user auth (schicht 1) ────────────────────────────
// Register/Login mit email+password (scrypt). Optional zum bestehenden
// pair-flow — wer keinen account hat, nutzt weiter device-pairing.
function _emailValid(s) {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

app.post("/api/auth/register", async (req, res) => {
  if (!usersStore) return res.status(503).json({ error: "multi-user nicht aktiv" });
  // Audit-fix: rate-limit gegen DoS via scrypt (selbe limiter wie login)
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const gate = loginRateLimiter.check(ip);
  if (!gate.allowed) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({
      error: "zu viele versuche, später erneut probieren",
      retryAfterSec: gate.retryAfterSec,
    });
  }
  const { email, password } = req.body || {};
  if (!_emailValid(email)) {
    loginRateLimiter.recordFailure(ip);
    return res.status(400).json({ error: "email ungültig" });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    loginRateLimiter.recordFailure(ip);
    return res.status(400).json({ error: "passwort muss mind. 8 zeichen sein" });
  }
  // Audit-fix: bootstrap-guard — der allererste user wird OWNER ALLER
  // bestehenden projekte. Damit ein angreifer auf einem öffentlich
  // erreichbaren server nicht den account klauen kann: erste registrierung
  // muss von localhost kommen.
  // SECURITY-FIX: vorher inline-check mit ||-or-logik konnte über
  // cloudflare-tunnel umgangen werden (req.ip = 127.0.0.1 via cloudflared
  // → isLocal=true trotz fremdem origin). Jetzt zentraler helper der
  // ip+host BEIDES prüft.
  const isLocal = isLocalRequest(req);
  let anyMembership = false;
  if (memberships) {
    for (const p of (state.projects || [])) {
      if ((memberships.listMembers(p.id) || []).length > 0) { anyMembership = true; break; }
    }
  }
  if (!anyMembership && !isLocal) {
    return res.status(403).json({
      error: "erster account muss von localhost (desktop) erstellt werden",
    });
  }
  let hash;
  try { hash = hashPassword(password); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  let user;
  try { user = usersStore.registerUser({ email, passwordHash: hash }); }
  catch (e) {
    if (/already exists/i.test(e.message)) return res.status(409).json({ error: "email bereits registriert" });
    return res.status(400).json({ error: e.message });
  }
  // Bootstrap: NUR der allererste user im system bekommt OWNER für alle
  // bestehenden projekte. Weitere user müssen via /api/projects/:id/members
  // eingeladen werden. Pair-tokens behalten legacy-vollzugriff unabhängig.
  if (memberships) {
    let anyMembership = false;
    for (const p of (state.projects || [])) {
      if ((memberships.listMembers(p.id) || []).length > 0) { anyMembership = true; break; }
    }
    if (!anyMembership) {
      for (const p of (state.projects || [])) {
        try {
          memberships.addMember({
            projectId: p.id, userId: user.id,
            role: ROLES.OWNER, addedBy: user.id,
          });
        } catch (e) { /* foreign-key falls user nicht gefunden — unwahrscheinlich */ }
      }
      console.log("[auth] bootstrap: erster user → owner aller bestehenden projekte");
    } else {
      // Kein bootstrap: prüfe ob es pre-invite gibt (owner hat vor register
      // schon eingeladen). Übernehmen + cleanup.
      try {
        const claimed = memberships.claimPendingForEmail(user.email, user.id);
        if (claimed.length > 0) {
          console.log("[auth] register:", user.email, "claimed", claimed.length, "pending invite(s)");
        }
      } catch (e) {
        console.log("[auth] claim-pending failed for", user.email, "-", e.message);
      }
    }
  }
  const sess = usersStore.createSession({ userId: user.id, ttlMs: USER_SESSION_TTL_MS });
  console.log("[auth] register:", user.email);
  // Nach claim: broadcast neuen state, damit owner-tabs die neue
  // membership in /api/projects/:id/members sehen + invitee bei WS-connect
  // direkt seine projekte bekommt.
  broadcastState();
  res.status(201).json({
    token: sess.token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    expiresAt: sess.expiresAt,
  });
});

app.post("/api/auth/login", async (req, res) => {
  if (!usersStore) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  // Owner auf localhost umgeht den rate-limiter — sonst sperrt er sich
  // selbst aus bei vertippern. Nur fremde IPs (über tunnel/LAN) sind
  // limit-relevant (brute-force-schutz).
  const isLocal = isLocalRequest(req);
  if (!isLocal) {
    const gate = loginRateLimiter.check(ip);
    if (!gate.allowed) {
      res.set("Retry-After", String(gate.retryAfterSec));
      return res.status(429).json({
        error: "zu viele fehlversuche, später erneut probieren",
        retryAfterSec: gate.retryAfterSec,
      });
    }
  }
  const { email, password } = req.body || {};
  if (!_emailValid(email) || !password || typeof password !== "string") {
    if (!isLocal) loginRateLimiter.recordFailure(ip);
    return res.status(400).json({ error: "email + passwort erforderlich" });
  }
  const user = usersStore.findUserByEmail(email);
  // Bessere fehler-unterscheidung: wenn die email nicht registriert ist,
  // sagen wir das. Sonst sagen wir 'passwort falsch'. Auf einem öffentlichen
  // server wäre das email-enumeration risiko — auf einem personal-server
  // mit single-digit users ist die klarheit für den user wichtiger.
  if (!user) {
    if (!isLocal) loginRateLimiter.recordFailure(ip);
    return res.status(404).json({ error: "email nicht registriert — erst auf 'registrieren' klicken oder vertippt?" });
  }
  if (!verifyPassword(password, user.passwordHash)) {
    if (!isLocal) loginRateLimiter.recordFailure(ip);
    return res.status(401).json({ error: "passwort falsch" });
  }
  const sess = usersStore.createSession({ userId: user.id, ttlMs: USER_SESSION_TTL_MS });
  console.log("[auth] login:", user.email);
  res.json({
    token: sess.token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    expiresAt: sess.expiresAt,
  });
});

// Admin-reset-password — localhost-only. Owner kann am desktop einen
// vergessenen account-password zurücksetzen (eigenen oder eingeladenen).
// Schutz: nur von 127.0.0.1 + localhost-hostname (isLocalRequest).
// Claim-invite: einfacher flow für eingeladene user — sie geben ihre
// email ein, server prüft pending_invites, erstellt user automatisch
// mit zufalls-passwort + session, klappt direkt. kein register-modal
// nötig.
// Nutzbar von tunnel (kein localhost-gate) weil sicherheit via
// pending_invite gewährleistet ist (owner hat email vorher whitelisted).
app.post("/api/auth/claim-invite", async (req, res) => {
  if (!usersStore || !memberships) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const { email } = req.body || {};
  if (!_emailValid(email)) return res.status(400).json({ error: "email ungültig" });
  const normalized = String(email).trim().toLowerCase();

  // Hat die email eine pending einladung?
  let hasPending = false;
  try {
    for (const p of state.projects) {
      const pending = memberships.listPendingForProject ? memberships.listPendingForProject(p.id) : [];
      if (pending.some(i => i.email === normalized)) { hasPending = true; break; }
    }
  } catch (_) {}

  // Existiert die email schon als user?
  const existing = usersStore.findUserByEmail(normalized);
  if (existing) {
    // user existiert + hat pending invites → wir können sie nicht autologin
    // (kein passwort gegeben). antwort: "du bist bereits registriert, log dich ein".
    if (hasPending) {
      // claim pending in case noch nicht passiert
      try { memberships.claimPendingForEmail(normalized, existing.id); } catch (_) {}
    }
    return res.status(409).json({
      error: "diese email ist bereits registriert. bitte normal einloggen mit deinem passwort.",
      needsPassword: true,
    });
  }

  if (!hasPending) {
    return res.status(404).json({
      error: "keine einladung für diese email gefunden. frag den team-owner, dich erst einzuladen.",
    });
  }

  // user erstellen mit zufalls-passwort (wird vom user nicht gebraucht;
  // er kann später per admin-reset-password setzen). dann claim + session.
  const randomPw = crypto.randomBytes(24).toString("base64url");
  let hash;
  try { hash = hashPassword(randomPw); }
  catch (e) { return res.status(500).json({ error: e.message }); }
  let user;
  try { user = usersStore.registerUser({ email: normalized, passwordHash: hash }); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    const claimed = memberships.claimPendingForEmail(user.email, user.id);
    console.log("[auth] claim-invite:", user.email, "claimed", claimed.length, "invite(s)");
  } catch (e) { console.log("[auth] claim-pending failed:", e.message); }

  const sess = usersStore.createSession({ userId: user.id, ttlMs: USER_SESSION_TTL_MS });
  broadcastState();
  res.status(201).json({
    token: sess.token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    expiresAt: sess.expiresAt,
    viaInvite: true,
  });
});

app.post("/api/auth/admin-reset-password", async (req, res) => {
  if (!usersStore) return res.status(503).json({ error: "multi-user nicht aktiv" });
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: "passwort-reset nur vom desktop/localhost — auf deinem rechner einloggen, dort resetten" });
  }
  const { email, newPassword } = req.body || {};
  if (!_emailValid(email)) return res.status(400).json({ error: "email ungültig" });
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "neues passwort muss mind. 8 zeichen sein" });
  }
  if (!usersStore.findUserByEmail(email)) {
    return res.status(404).json({ error: "email nicht registriert" });
  }
  let hash;
  try { hash = hashPassword(newPassword); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const ok = usersStore.adminResetPassword({ email, passwordHash: hash });
    if (!ok) return res.status(404).json({ error: "reset fehlgeschlagen" });
    console.log("[auth] admin-reset password:", email);
    res.json({ ok: true, email: String(email).trim().toLowerCase() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token && usersStore) usersStore.revokeSession(token);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!usersStore) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const us = usersStore.resolveSession(token);
  if (!us) return res.status(401).json({ error: "unauthorized" });
  const user = usersStore.findUserById(us.userId);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  res.json({
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    expiresAt: us.expiresAt,
  });
});

// Auth-Middleware
// Akzeptiert ZWEI token-arten:
//  1) pair-token (in-memory `sessions` Map) — bestehender flow für gepairte geräte
//  2) user-token (sqlite via usersStore) — multi-user schicht 1
// Bei user-tokens wird eine synthetische session erzeugt und req.user gesetzt.
function authMw(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "unauthorized" });

  // 1) pair-token (device-session)
  if (sessions.has(token)) {
    req.session = sessions.get(token);
    req.token = token;
    req.session.lastSeen = NOW();
    return next();
  }

  // 2) user-token (multi-user)
  if (usersStore) {
    const us = usersStore.resolveSession(token);
    if (us) {
      const user = usersStore.findUserById(us.userId);
      if (user) {
        // Synthetische device-session, damit der rest des codes (req.session)
        // weiter funktioniert. deviceType bleibt "user" zur abgrenzung.
        req.session = {
          deviceName: user.email,
          deviceType: "user",
          since: us.expiresAt - USER_SESSION_TTL_MS,
          lastSeen: NOW(),
          userId: user.id,
        };
        req.token = token;
        req.user = { id: user.id, email: user.email };
        return next();
      }
    }
  }

  return res.status(401).json({ error: "unauthorized" });
}

app.get("/api/state", authMw, (req, res) => {
  res.json({ state: publicState(req.session) });
});

// ─── Setup / Settings ───────────────────────────────────────
// Setup-status: zeigt UI, ob claude-cli verfügbar ist + welche keys gesetzt
// sind. Wird beim ersten start angezeigt + im settings-modal.
app.get("/api/setup/status", authMw, (req, res) => {
  res.json({
    claude: claudeCliInfo,
    settings: userSettings.getAllMasked(),
    knownKeys: SETTING_KEYS,
  });
});

// Settings: schreibt key. Nur user-token erlaubt (vermeidet dass jedes
// anonyme pair-device API-keys ändert), bzw. desktop-session.
app.post("/api/setup/settings", authMw, (req, res) => {
  // user-session ODER desktop-pair-session erlaubt (kein mobile-pair)
  const sess = req.session;
  const allowed = (sess && sess.userId) || (sess && sess.deviceType === "desktop");
  if (!allowed) return res.status(403).json({ error: "nur user- oder desktop-session darf settings ändern" });
  const { key, value } = req.body || {};
  if (typeof key !== "string") return res.status(400).json({ error: "key fehlt" });
  try {
    const masked = userSettings.setKey(key, value);
    res.json({ ok: true, settings: masked });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Deps-check: alle abhängigkeiten auf einen blick ───────
app.get("/api/setup/deps", authMw, (req, res) => {
  const report = depsCheckAll();
  const missing = depsMissingRequired(report);
  res.json({ deps: report, missingRequired: missing });
});

// Auto-fix-all: installiert alles per npm was nachinstallierbar ist (aktuell:
// claude). Andere deps brauchen manuelle download (ngrok/flutter/adb).
app.post("/api/setup/auto-fix", authMw, (req, res) => {
  const sess = req.session;
  const allowed = (sess && sess.userId) || (sess && sess.deviceType === "desktop");
  if (!allowed) return res.status(403).json({ error: "nur user- oder desktop-session" });
  const report = depsCheckAll();
  const missing = depsMissingRequired(report);
  const npmInstalls = missing.filter(m => m.install && m.install.npm);
  const manualSteps = missing.filter(m => m.install && m.install.url);
  if (npmInstalls.length === 0) {
    return res.json({ ok: true, installed: [], manualSteps });
  }
  const { spawn } = require("child_process");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // strict npm-package-name validation — shell:true unten ist auf win32
  // nötig (npm.cmd, CVE-2024-27980), also muss der pkg-name garantiert
  // shell-safe sein. erlaubt: optional @scope/, lowercase/digits/._-
  const NPM_PKG_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
  // Sequenziell installieren — npm-globals dürfen nicht parallelisiert werden
  (async () => {
    const installed = [];
    const skipped = [];
    for (const m of npmInstalls) {
      const pkg = m.install.npm;
      if (typeof pkg !== "string" || pkg.length > 214 || !NPM_PKG_RE.test(pkg)) {
        skipped.push({ name: m.name, reason: "invalid pkg-name" });
        continue;
      }
      const proc = spawn(npm, ["install", "-g", pkg], { shell: true, windowsHide: true });
      await new Promise((resolve) => {
        proc.on("close", (code) => { if (code === 0) installed.push(m.name); resolve(); });
        proc.on("error", () => resolve());
      });
    }
    res.json({ ok: true, installed, manualSteps, skipped });
  })().catch((e) => res.status(500).json({ error: e.message }));
});

// Setup-trigger: claude-cli nachinstallieren via npm. Best-effort,
// kann ~30s dauern. Liefert stdout/stderr für ui.
app.post("/api/setup/install-claude", authMw, (req, res) => {
  const sess = req.session;
  const allowed = (sess && sess.userId) || (sess && sess.deviceType === "desktop");
  if (!allowed) return res.status(403).json({ error: "nur user- oder desktop-session" });
  if (claudeCliInfo.installed) return res.json({ ok: true, alreadyInstalled: true });
  const { spawn } = require("child_process");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const proc = spawn(npm, ["install", "-g", "@anthropic-ai/claude-code"], {
    shell: true, windowsHide: true,
  });
  let out = "", err = "";
  proc.stdout.on("data", c => { out += c.toString(); });
  proc.stderr.on("data", c => { err += c.toString(); });
  proc.on("close", (code) => {
    if (code === 0) {
      // detection erneut
      const detect = require("child_process").spawnSync(
        process.platform === "win32" ? path.join(process.env.APPDATA || "", "npm", "claude.cmd") : "claude",
        ["--version"], { timeout: 5000, encoding: "utf8", shell: process.platform === "win32" },
      );
      if (detect.status === 0) {
        claudeCliInfo = { installed: true, version: detect.stdout.trim().split("\n")[0], path: "auto-installed", error: null };
      }
      res.json({ ok: true, version: claudeCliInfo.version, out: out.slice(-500), err: err.slice(-500) });
    } else {
      res.status(500).json({ ok: false, code, out: out.slice(-500), err: err.slice(-500) });
    }
  });
  proc.on("error", (e) => res.status(500).json({ ok: false, error: e.message }));
});

app.post("/api/mutate", authMw, (req, res) => {
  const { type, payload } = req.body || {};
  if (!type) return res.status(400).json({ error: "type fehlt" });
  // Schicht-2 autorisierung: user-sessions brauchen rolle aufs projekt.
  const access = checkMutationAccess(type, payload, req.session, memberships);
  if (!access.ok) return res.status(access.status || 403).json({ error: access.reason });
  try {
    applyMutation(type, payload, { session: req.session });
    // ADD_PROJECT: anlegenden user automatisch als owner zum projekt hinzufügen.
    // Analog WS-handler: payload.project ist dieselbe object-ref wie in s.projects
    // gepusht (MUT.ADD_PROJECT setzt id inline). Robuster als length-1-zugriff.
    if (type === "ADD_PROJECT" && req.session && req.session.userId && memberships) {
      const created = payload && payload.project;
      if (created && created.id) {
        try {
          memberships.addMember({
            projectId: created.id, userId: req.session.userId,
            role: ROLES.OWNER, addedBy: req.session.userId,
          });
          // Audit-fix: state schon sync-persistiert. Sicherstellen dass
          // membership-DB-write nicht in einer racing transaction hängt.
          broadcastState();
        } catch (e) { console.warn("[membership] add owner failed:", e.message); }
      }
    }
    if (type === "CONVERT_IDEA" || type === "DISMISS_IDEA") {
      const proj = state.projects.find(p => p.id === payload?.projectId);
      const idea = proj && proj.ideas.find(i => i.id === payload?.ideaId);
      if (idea) emitPush({
        type: "idea_processed", projectId: proj.id, ideaText: idea.text,
        action: type === "CONVERT_IDEA" ? "task_created" : "dismissed",
      });
    }
    broadcastState();
    // Wenn der User CC einschaltet → Auto-Pump SOFORT triggern statt 25s warten.
    // Plus: Cool-Downs leeren damit auch kurz vorher fehlgeschlagene Tasks
    // wieder aufgenommen werden.
    if (type === "TOGGLE_CC" && payload?.running === true) {
      _autoPumpCooldowns.clear();
      setImmediate(() => { try { autoPumpTick(); } catch (e) {} });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("[mutate] failed:", e.message);
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/sessions", authMw, (req, res) => {
  // Desktop-Sessions sehen alle Tokens (für Device-Remove). User-Sessions
  // (multi-user) sehen NUR ihre eigene session — verhindert globalen
  // device-leak (audit-fix). Mobile-pair-sessions sehen nur sich selbst.
  const isDesktop = isDesktopSession(req.session);
  const list = [];
  for (const [token, s] of sessions) {
    const isMe = token === req.token;
    if (!isDesktop && !isMe) continue;
    list.push({
      token: isDesktop ? token : undefined,
      deviceName: s.deviceName,
      deviceType: s.deviceType,
      since: s.since,
      lastSeen: s.lastSeen,
      isMe,
    });
  }
  res.json({ sessions: list });
});

// Pro-Projekt Geräte-Übersicht: Live-Status + lastActivity. Tokens nur für desktop.
app.get("/api/projects/:id/devices", authMw, (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  // Schicht-2: nur projekt-mitglieder dürfen device-liste sehen (audit-bug)
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  const includeToken = isDesktopSession(req.session);
  const list = summarizeDevices({
    sessions, project, currentToken: req.token, now: NOW(),
  }).map(d => deviceView(d, { includeToken }));
  res.json({ projectId: project.id, devices: list });
});

// ─── Multi-user schicht 2: members ───────────────────────────
// owner darf andere user einladen/entfernen + rollen ändern.
// Sichtbar nur für sessions mit zugriff auf das projekt.
function _requireProjectAccess(req, res, project, minRole) {
  // Pair-sessions: legacy vollzugriff
  if (!req.session?.userId) return true;
  if (!memberships) { res.status(503).json({ error: "multi-user nicht aktiv" }); return false; }
  if (!memberships.hasRole(project.id, req.session.userId, minRole)) {
    res.status(403).json({ error: "keine berechtigung für projekt " + project.id });
    return false;
  }
  return true;
}

// Schicht 3 · catch-up: clients fragen seit ihrer letzten bekannten seq ab,
// um nach reconnect/offline-pause ohne full-state-resync auf den stand zu kommen.
// Zugriff: per session-scope, d.h. nur ops von projekten, die die session sehen darf.
app.get("/api/projects/:id/ops", authMw, (req, res) => {
  if (!opLogStore) return res.status(503).json({ error: "op_log nicht aktiv" });
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  // user-sessions: rolle prüfen (VIEWER reicht für read)
  if (req.session?.userId && memberships &&
      !memberships.hasRole(project.id, req.session.userId, ROLES.VIEWER)) {
    return res.status(403).json({ error: "keine berechtigung" });
  }
  const since = Number(req.query.since) || 0;
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  const ops = opLogStore.opsSince(project.id, since).slice(0, limit);
  const head = opLogStore.head(project.id);
  res.json({ projectId: project.id, since, ops, head });
});

// ─── Git-History + Rollback (Task 7) ──────────────────────────
// Listet die letzten cc-commits aus git log. Read-only, session-scoped.
app.get("/api/projects/:id/git/commits", authMw, async (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (req.session?.userId && memberships &&
      !memberships.hasRole(project.id, req.session.userId, ROLES.VIEWER)) {
    return res.status(403).json({ error: "keine berechtigung" });
  }
  if (!project.path || !gitIsRepo(project.path)) {
    return res.json({ projectId: project.id, isGitRepo: false, commits: [] });
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const commits = await gitListCcCommits(project.path, limit);
  res.json({ projectId: project.id, isGitRepo: true, commits });
});

// Rollback letzter cc-commit. Nur owner. Hard-reset HEAD~1. Lokal, kein push.
app.post("/api/projects/:id/git/rollback", authMw, async (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (req.session?.userId && memberships &&
      !memberships.hasRole(project.id, req.session.userId, ROLES.OWNER)) {
    return res.status(403).json({ error: "nur owner darf rollback" });
  }
  if (!project.path || !gitIsRepo(project.path)) {
    return res.status(400).json({ error: "kein git-repo" });
  }
  const r = await gitRollbackLast(project.path);
  if (!r.ok) return res.status(500).json({ error: r.error || "rollback fehlgeschlagen" });
  applyMutation("ADD_ACTIVITY", { projectId: project.id, event: {
    type: "warn", text: "git rollback (HEAD~1)",
  }});
  applyMutation("ADD_SYNC_LOG", { entry: {
    source: "system", projectId: project.id,
    text: "git rollback durch user · HEAD~1 hard-reset",
  }});
  broadcastState();
  res.json({ ok: true });
});

// ─── Attachments (bilder + files für chat) ────────────────────
// User uploaded base64 → server speichert in <project.path>/.pg-uploads/
// und liefert eine signed-relative-url für ADD_MESSAGE-attachment.
// Datei ist später via GET /api/projects/:id/attachments/:fileId abrufbar.
function _attachmentsDir(project) {
  if (!project.path || !fs.existsSync(project.path)) return null;
  try { assertSafeProjectPath(project.path, "attachments.projectPath"); }
  catch (_) { return null; }
  const dir = path.join(project.path, ".pg-uploads");
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { return null; }
  }
  return dir;
}

app.post("/api/projects/:id/attachments", authMw, (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  const dir = _attachmentsDir(project);
  if (!dir) return res.status(500).json({ error: "kein projekt-pfad für uploads" });
  const { name, contentType, base64 } = req.body || {};
  if (!base64 || typeof base64 !== "string") return res.status(400).json({ error: "base64 fehlt" });
  const safeName = String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const ext = path.extname(safeName) || ".bin";
  const fileId = crypto.randomBytes(8).toString("hex");
  const fullName = fileId + ext;
  const target = path.join(dir, fullName);
  try {
    const buf = Buffer.from(base64, "base64");
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: "datei zu groß (max 8 MB)" });
    fs.writeFileSync(target, buf);
    const kind = /^image\//i.test(String(contentType || "")) ? "image" : "file";
    res.status(201).json({
      fileId, name: safeName, kind, size: buf.length,
      url: `/api/projects/${project.id}/attachments/${fullName}`,
    });
  } catch (e) {
    res.status(500).json({ error: "schreiben fehlgeschlagen: " + e.message });
  }
});

app.get("/api/projects/:id/attachments/:file", authMw, (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  const dir = _attachmentsDir(project);
  if (!dir) return res.status(404).json({ error: "uploads nicht verfügbar" });
  const fname = String(req.params.file).replace(/[^a-zA-Z0-9._-]/g, "_");
  const p = path.join(dir, fname);
  if (!p.startsWith(dir) || !fs.existsSync(p)) return res.status(404).json({ error: "nicht gefunden" });
  res.sendFile(p);
});

// Online-Presence: welche team-member sind gerade per WS verbunden?
// Wir scannen wss.clients, gucken die _session.userId an, mappen zu emails.
app.get("/api/projects/:id/presence", authMw, (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  const liveUserIds = new Set();
  if (wss && wss.clients) {
    for (const c of wss.clients) {
      if (c.readyState !== 1) continue;
      if (c._session && c._session.userId) liveUserIds.add(c._session.userId);
    }
  }
  // Liste der members des projekts + online-flag
  const members = (memberships ? memberships.listMembers(project.id) : []) || [];
  const out = members.map((m) => {
    const u = usersStore && usersStore.findUserById(m.userId);
    return {
      userId: m.userId, email: u ? u.email : null, role: m.role,
      online: liveUserIds.has(m.userId),
    };
  });
  res.json({ projectId: project.id, presence: out });
});

// ─── Projekt-Archive (download projekt-ordner als zip) ─────────
// Team-member kann den projekt-folder als zip runterladen. Server zipt on-demand
// via powershell (windows) / zip (linux). Common ignore-patterns ausgeschlossen.
async function _zipProjectFolder(project) {
  if (!project.path || !fs.existsSync(project.path)) return null;
  try { assertSafeProjectPath(project.path, "archive.projectPath"); }
  catch (_) { return null; }
  const tmpDir = path.join(__dirname, ".pg-archives");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const fileId = crypto.randomBytes(6).toString("hex");
  const out = path.join(tmpDir, `${project.id}_${fileId}.zip`);
  const { spawn } = require("child_process");
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      // powershell Compress-Archive — ignoriert node_modules/build/.git per filter
      const ps = `Get-ChildItem -Path '${project.path.replace(/'/g, "''")}' -Recurse -File ` +
        `| Where-Object { $_.FullName -notmatch '(\\\\|\\/)(node_modules|\\.git|build|\\.dart_tool|\\.pg-uploads|\\.pg-archives)(\\\\|\\/)' } ` +
        `| Compress-Archive -DestinationPath '${out.replace(/'/g, "''")}' -Force`;
      const proc = spawn("powershell", ["-NoProfile", "-Command", ps], {
        shell: false, windowsHide: true,
      });
      proc.on("close", (code) => resolve(code === 0 ? out : null));
      proc.on("error", () => resolve(null));
    } else {
      const proc = spawn("zip", ["-r", "-q", out, ".",
        "-x", "*/node_modules/*", "*/.git/*", "*/build/*", "*/.dart_tool/*",
        "*/.pg-uploads/*", "*/.pg-archives/*"],
        { cwd: project.path });
      proc.on("close", (code) => resolve(code === 0 ? out : null));
      proc.on("error", () => resolve(null));
    }
  });
}

app.post("/api/projects/:id/archive", authMw, async (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  const zipPath = await _zipProjectFolder(project);
  if (!zipPath) return res.status(500).json({ error: "archiv konnte nicht erstellt werden (pfad fehlt?)" });
  const fname = path.basename(zipPath);
  const stats = fs.statSync(zipPath);
  res.json({
    fileId: fname.replace(/\.zip$/, ""),
    size: stats.size,
    url: `/api/projects/${project.id}/archive/${fname}`,
    createdAt: NOW(),
  });
});

app.get("/api/projects/:id/archive/:file", authMw, (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  const fname = String(req.params.file).replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(__dirname, ".pg-archives");
  const p = path.join(dir, fname);
  if (!p.startsWith(dir) || !fs.existsSync(p)) return res.status(404).json({ error: "nicht gefunden" });
  res.setHeader("Content-Disposition", `attachment; filename="${project.name}-${fname}"`);
  res.sendFile(p);
});

app.get("/api/projects/:id/members", authMw, (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!memberships) return res.json({ projectId: project.id, members: [] });
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  const raw = memberships.listMembers(project.id);
  const out = raw.map((m) => {
    const u = usersStore && usersStore.findUserById(m.userId);
    return { userId: m.userId, email: u ? u.email : null, role: m.role, addedAt: m.addedAt };
  });
  // Pending invites (vor-eingeladene emails ohne registrierten user) ebenfalls
  // ausgeben — UI kann sie als "wartet auf registrierung" anzeigen.
  const pending = memberships.listPendingForProject
    ? memberships.listPendingForProject(project.id).map(p => ({
        email: p.email, role: p.role, addedAt: p.addedAt, pending: true,
      }))
    : [];
  res.json({ projectId: project.id, members: out, pending });
});

app.post("/api/projects/:id/members", authMw, (req, res) => {
  if (!memberships || !usersStore) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.OWNER)) return;
  const { email, role } = req.body || {};
  if (!email || typeof email !== "string") return res.status(400).json({ error: "email fehlt" });
  const r = (role && [ROLES.OWNER, ROLES.MEMBER, ROLES.VIEWER].includes(role)) ? role : ROLES.MEMBER;
  const target = usersStore.findUserByEmail(email);

  // Pending-invite-flow: wenn user noch nicht registriert ist, speichern wir
  // die einladung. Beim register wird sie automatisch als membership übernommen.
  // Behebt das "user nicht gefunden"-friction wenn owner einlädt, bevor der
  // kollege auf der tunnel-URL einen account angelegt hat.
  if (!target) {
    try {
      const inv = memberships.addPendingInvite({
        projectId: project.id, email, role: r,
        addedBy: req.session?.userId || null,
      });
      console.log("[membership] pending invite:", inv.email, "->", project.id, r);
      broadcastState();
      return res.status(202).json({
        pending: true, email: inv.email, projectId: project.id, role: r,
        message: "einladung gespeichert — wird aktiv sobald sich der user mit dieser email registriert.",
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  try {
    const m = memberships.addMember({
      projectId: project.id, userId: target.id, role: r,
      addedBy: req.session?.userId || null,
    });
    console.log("[membership] add:", target.email, "->", project.id, r);
    // Audit-fix: invitee bekommt sonst stale state. broadcastState aktualisiert
    // alle ws-clients per session-gefilterter sicht.
    broadcastState();
    // Push-notification an eingeladenen user (audit-fix): aktuell silent.
    // emitPush sendet an alle live ws-clients — wir filtern client-seitig
    // auf den invited user via _session.userId match in WS.
    emitPush({
      type: "project_invited",
      projectId: project.id,
      projectName: project.name,
      invitedUserId: target.id,
      invitedEmail: target.email,
      role: r,
      inviter: req.session?.deviceName || "owner",
    });
    res.status(201).json({ ...m, email: target.email });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Pending-invite entfernen: owner kann seine wartende einladung zurücknehmen.
// userId-prefix "pending:<email>" damit der existierende DELETE-handler die
// zwei fälle (echter user vs pending) unterscheidet.
app.delete("/api/projects/:id/pending/:email", authMw, (req, res) => {
  if (!memberships) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.OWNER)) return;
  try {
    memberships.removePendingInvite(project.id, decodeURIComponent(req.params.email));
    broadcastState();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/projects/:id/members/:userId", authMw, (req, res) => {
  if (!memberships) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.OWNER)) return;
  // Verhindert das letzte owner-removal — sonst ist das projekt waise.
  const targetId = req.params.userId;
  const all = memberships.listMembers(project.id) || [];
  const targetIsOwner = all.find((m) => m.userId === targetId && m.role === ROLES.OWNER);
  const ownerCount = all.filter((m) => m.role === ROLES.OWNER).length;
  if (targetIsOwner && ownerCount <= 1) {
    return res.status(400).json({ error: "letzter owner kann nicht entfernt werden" });
  }
  memberships.removeMember(project.id, targetId);
  // Audit-fix: entfernter user soll projekt sofort aus state verlieren
  broadcastState();
  res.json({ ok: true });
});

// Mobile-Auto-Update: liefert release-info (version+sha256+size) für die zuletzt
// gebaute debug-apk. Mobile-app pollt /info, vergleicht eigene version, lädt
// /download und verifiziert sha256 vor dem install. Auth via session-token,
// damit nur gepairte geräte zugreifen können.
function resolveMobileApkProject(req) {
  const projectId = req.query.projectId || "projectgamma";
  const project = state.projects.find(p => p.id === projectId);
  if (!project || !project.path) return null;
  const mobileDir = path.join(project.path, "mobile-app");
  try { assertSafeProjectPath(mobileDir, "apkUpdate.mobileDir"); }
  catch (err) {
    console.warn("[apkUpdate] unsicherer mobile-pfad verworfen:", err.message);
    return null;
  }
  return { project, mobileDir };
}

app.get("/api/updates/apk/info", authMw, (req, res) => {
  const r = resolveMobileApkProject(req);
  if (!r) return res.status(404).json({ error: "mobile-projekt nicht gefunden" });
  const info = apkRelease.readReleaseInfo(r.mobileDir);
  if (!info) return res.status(404).json({ error: "keine apk verfügbar" });
  const { apkPath: _omit, ...publicInfo } = info;
  res.json({ projectId: r.project.id, ...publicInfo });
});

app.get("/api/updates/apk/download", authMw, (req, res) => {
  const r = resolveMobileApkProject(req);
  if (!r) return res.status(404).json({ error: "mobile-projekt nicht gefunden" });
  const info = apkRelease.readReleaseInfo(r.mobileDir);
  if (!info) return res.status(404).json({ error: "keine apk verfügbar" });
  // assertSafeProjectPath erneut: regel "spawn-/io-pfade unmittelbar vor zugriff
  // re-validieren". apkPath kommt aus stat-modul, aber state.json kann veraltet
  // sein → defense-in-depth.
  try { assertSafeProjectPath(info.apkPath, "apkUpdate.apkPath"); }
  catch (err) { return res.status(500).json({ error: "unsicherer apk-pfad" }); }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("X-Apk-Sha256", info.sha256);
  res.setHeader("X-Apk-Version", info.version);
  res.setHeader("Content-Length", String(info.size));
  res.setHeader("Content-Disposition",
    `attachment; filename="projectgamma-${info.version}.apk"`);
  fs.createReadStream(info.apkPath).pipe(res);
});

app.post("/api/logout", authMw, (req, res) => {
  sessions.delete(req.token);
  idleTracker.removeSession(req.token);
  persistSessions();
  // Trenne ggf. offene WS für diesen Token
  for (const c of wss.clients) {
    if (c._token === req.token) try { c.close(); } catch (e) {}
  }
  res.json({ ok: true });
});

// Idle-status melden. Body: { idle: boolean, since?: number (ms epoch) }.
// Mobile clients schicken idle=true wenn screen >5min off war, desktop bei
// lock/idle. allIdle-übergang triggert autopump sofort (siehe idleTracker).
app.post("/api/idle", authMw, (req, res) => {
  const { idle, since } = req.body || {};
  if (typeof idle !== "boolean") {
    return res.status(400).json({ error: "idle muss boolean sein" });
  }
  const safeSince = typeof since === "number" && since > 0 ? since : NOW();
  idleTracker.setIdle(req.token, idle, safeSince);
  res.json({ ok: true, allIdle: idleTracker.allIdle(), idleCount: idleTracker.idleCount() });
});

// Device entfernen (vom Desktop initiiert, betrifft anderen Token).
// Nur desktop-sessions dürfen fremde geräte trennen.
app.delete("/api/sessions/:token", authMw, (req, res) => {
  if (!isDesktopSession(req.session)) return res.status(403).json({ error: "nur desktop darf geräte trennen" });
  const targetToken = req.params.token;
  if (!sessions.has(targetToken)) return res.status(404).json({ error: "session nicht gefunden" });
  if (targetToken === req.token) return res.status(400).json({ error: "eigene session per /api/logout entfernen" });

  const target = sessions.get(targetToken);
  sessions.delete(targetToken);
  idleTracker.removeSession(targetToken);
  persistSessions();

  // WebSocket des entfernten Geräts schließen → Phone merkt es und zeigt Pairing-Screen
  for (const c of wss.clients) {
    if (c._token === targetToken) {
      try { c.send(JSON.stringify({ type: "REVOKED" })); } catch (e) {}
      try { c.close(); } catch (e) {}
    }
  }

  applyMutation("ADD_SYNC_LOG", { entry: {
    source: "system",
    text: `gerät getrennt: <i>${escapeHtml(target.deviceName)}</i> (${target.deviceType})`,
    projectId: state.projects[0]?.id || null,
  }});
  broadcastState();

  console.log("[session] removed:", target.deviceName);
  res.json({ ok: true, deviceName: target.deviceName });
});

// ─── Claude-Code-Integration (echte CLI) ────────────────────
// Status: idle | running. Pro Projekt höchstens 1 laufender Job.
const ccJobs = new Map(); // projectId -> { proc, startedAt, taskId, prompt, lines }
// cwds, für die in dieser server-laufzeit schon mindestens eine cc-session
// gelaufen ist. nur dann ist --continue safe — sonst bricht claude CLI mit
// "no conversations found in this directory" ab und cc hängt 'in der luft'.
// Reset on restart ist ok: erster run pro session zahlt halt einen
// cache-miss, danach wieder hits.
const ccProjectsWithSession = new Set();

// Filesystem-check: claude-CLI legt pro cwd einen ordner in
// ~/.claude/projects/<encoded>/ an. wenn der existiert, gibt es schon
// frühere conversations und --continue ist safe — auch beim allerersten
// cc-spawn nach server-restart. Spart 1× cache-cold-start pro restart.
function _hasClaudeHistoryFor(cwd) {
  try {
    const pathMod = require("node:path");
    const fsMod = require("node:fs");
    const os = require("node:os");
    if (!cwd) return false;
    // Encoding: : → -, / → -, \ → -, mehrere - bleiben (entspricht CLI-format)
    const abs = pathMod.resolve(cwd);
    const encoded = abs.replace(/[:\/\\]/g, "-");
    const dir = pathMod.join(os.homedir(), ".claude", "projects", encoded);
    if (!fsMod.existsSync(dir)) return false;
    // mindestens eine .jsonl-conversation muss drin sein
    const list = fsMod.readdirSync(dir);
    return list.some(f => f.endsWith(".jsonl"));
  } catch (_) { return false; }
}

function ccStatus(projectId) {
  const j = ccJobs.get(projectId);
  if (!j) return { state: "idle" };
  return { state: "running", startedAt: j.startedAt, taskId: j.taskId, prompt: j.prompt, lines: j.lines.length };
}

// Wird von /api/cc/run UND vom Auto-Pump aufgerufen.
// Liefert {ok:true} oder wirft Error (status property optional).
async function triggerCc(projectId, taskId, prompt) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) { const e = new Error("projekt nicht gefunden"); e.status = 404; throw e; }
  if (_isProjectBusy(projectId)) { const e = new Error("cloud-code läuft bereits"); e.status = 409; throw e; }
  // Regel-Linter vor jedem Cloud-Code-Run (errors blockieren, warnings nur loggen)
  const lint = lintCcRules(project);
  console.log("[cc] " + formatCcLint(lint));
  if (!lint.ok) {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn",
      text: "cloud-code blockiert (rule_linter): " + escapeHtml(lint.errors.join(" · ")),
    }});
    broadcastState();
    const e = new Error("regel-linter blockiert: " + lint.errors.join("; "));
    e.status = 412;
    throw e;
  }
  const result = _startCcJob(project, taskId, prompt);
  return result;
}

app.post("/api/cc/run", authMw, async (req, res) => {
  const { projectId, taskId, prompt } = req.body || {};
  if (!projectId) return res.status(400).json({ error: "projectId fehlt" });
  // Security (audit-fix): cross-tenant cc-runs via authed token-only verhindern
  const _project = state.projects.find(p => p.id === projectId);
  if (!_project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, _project, ROLES.MEMBER)) return;
  try {
    const r = await triggerCc(projectId, taskId, prompt);
    res.json({ ok: true, projectId, startedAt: r.startedAt });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
  return; // Rest des Handlers ist im _startCcJob
});

function _startCcJob(project, taskId, prompt) {
  const projectId = project.id;

  // Bug-fix: vorher fiel cwd silent auf process.cwd() (= sync-server/) zurück,
  // wenn project.path fehlte/nicht existierte. cc lief dann im server-folder
  // und sah nur sync-server-files — symptom: "cc liest/grept, schreibt aber
  // nichts". Jetzt: klarer fehler mit activity-log statt fake-run.
  if (!project.path || !fs.existsSync(project.path)) {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn",
      text: "cloud-code blockiert: projekt-pfad fehlt oder existiert nicht — bitte in den projekt-einstellungen setzen " +
            "(<code>" + escapeHtml(project.path || "(leer)") + "</code>)",
    }});
    broadcastState();
    const e = new Error("projekt-pfad fehlt oder existiert nicht auf diesem rechner: " +
      JSON.stringify(project.path || "") + " — setze ihn in den projekt-einstellungen");
    e.status = 412;
    throw e;
  }
  const cwd = project.path;
  const task = taskId ? project.tasks.find(t => t.id === taskId) : null;

  // Prompt zusammenstellen aus Projekt-Kontext (Regeln, Ziele, Aufgabe).
  // Bitte claude am Ende einen JSON-Block mit Regel-Vorschlägen auszugeben,
  // den der Server parsed und als „cc-vorschlag"-Regeln erstellt (inaktiv).
  // ─── SMART CONTEXT (BM25 retrieval) ─────────────────────────
  // Statt alle rules/activity/bugs in den prompt zu dumpen, picken wir die
  // task-relevantesten via BM25-keyword-überlappung. Query = task.title +
  // optionaler prompt-text. Spart 50-80% prompt-tokens bei projekten mit
  // vielen rules ohne kontext-verlust für den aktuellen task.
  // (master-spec items: smart context loading, semantic retrieval,
  // multi-memory — domains: rules=semantic, activity=long-term, bugs=project)
  const _query = ((task && task.title) || prompt || "").slice(0, 500);

  // Active rules: IMMER alle einhalten (kein retrieval), aber wenn projekt
  // viele hat → nur top-N relevante prominent zeigen + rest als "+N weitere".
  const _activeAll = project.rules.filter(r => r.active);
  let activeRules;
  if (_activeAll.length <= 8) {
    activeRules = _activeAll.map(r => "- " + r.text);
  } else {
    const topActive = _pickContextTopK({
      query: _query, corpus: _activeAll, k: 6, idKey: "id", textKey: "text",
    });
    activeRules = [
      ...topActive.map(r => "- " + r.text),
      `- (+ ${_activeAll.length - topActive.length} weitere aktive regeln — wenn relevant, im projekt-state schauen)`,
    ];
  }

  // Inactive rules + removed rules: nur die task-relevantesten (BM25, k=3).
  const inactiveRules = _pickContextTopK({
    query: _query,
    corpus: project.rules.filter(r => !r.active),
    k: 3, idKey: "id", textKey: "text",
  }).map(r => "- " + String(r.text || "").slice(0, 100));
  const removedRules = _pickContextTopK({
    query: _query,
    corpus: project.removedRules || [],
    k: 3, idKey: "id", textKey: "text",
  }).map(r => "- " + String(r.text || "").slice(0, 80));
  const goals = project.goals || [];

  // recentActivity/openBugs/lastCcCheck wurden entfernt — sie lenkten cc
  // vom konkreten task ab. wenn cc kontext braucht, soll er gezielt via
  // Read den state lesen. spart auch BM25-cycles pro spawn.

  // Failure-context: wenn dieser run ein retry ist (vorheriger build/test
  // fehlgeschlagen), fügen wir die fehlerausgabe in den prompt ein, damit
  // cc gezielt den fehler fixt statt blind nochmal zu versuchen.
  const retryContext = _ccRetryContext.get(taskId || "");

  const fullPrompt = [
    "Arbeite am Projekt: " + project.name + " (" + project.tech + ").",
    "PROJEKT-PFAD: " + cwd,
    "WICHTIG: alle datei-operationen (Read/Edit/Write/Glob/Grep/Bash) müssen",
    "in diesem pfad oder darunter stattfinden. Das ist KEIN sync-server-projekt,",
    "es ist das echte ziel-projekt — schreibe wirklich code, nicht nur lesen.",
    "",
    goals.length ? "PROJEKTZIELE:\n" + goals.map(g => "- " + g).join("\n") : "",
    activeRules.length ? "AKTIVE REGELN (immer einhalten):\n" + activeRules.join("\n") : "",
    // entfernt (lenkten cc ab — er hat task ignoriert und stattdessen
    // git-status/curl-localhost/aufräum-arbeit gemacht):
    //   - INAKTIVE REGELN
    //   - KÜRZLICH ENTFERNTE REGELN
    //   - LETZTE PROJEKT-AKTIVITÄT
    //   - OFFENE BUGS
    //   - LETZTER CC-CHECKMARK
    // wenn cc kontext braucht kann er via Read selber lesen. weniger
    // prompt = weniger distraction + weniger tokens.
    "",
    "AUFGABE (das und NUR das — keine seiten-arbeit, kein freilauf):",
    task ? task.title : (prompt || "Was wäre als nächstes sinnvoll? Gib einen kurzen Plan in 3-5 Punkten."),
    task?.description ? "BESCHREIBUNG:\n" + task.description.slice(0, 1500) : "",
    task && prompt ? "\nZUSATZ: " + prompt : "",
    "",
    "⚠️ FOKUS-GUARDRAIL (das ist die wichtigste regel hier):",
    "- mach NUR den AUFGABE-text oben. NICHTS sonst.",
    "- KEIN ungebetenes `git status`, `git diff`, `git log`, `npm test`,",
    "  `flutter analyze`, `Get-Process`, `tail logs` außer wenn die aufgabe",
    "  das EXPLIZIT verlangt.",
    "- KEINE HTTP-requests gegen `localhost`/`127.0.0.1`/`::1` (auch nicht",
    "  via `curl`, `wget`, `Invoke-RestMethod`/`iwr`, `Invoke-WebRequest`,",
    "  `fetch`, `http.get`, `requests.get` etc.) — der sync-server ist NICHT",
    "  dein context-store, lies files direkt mit Read/Glob/Grep.",
    "- KEIN aufräumen, KEIN refactor neben dem task, KEIN test-runner.",
    "- bei TRIVIAL-task (1 datei, < 50 LOC, klare anweisung):",
    "  → direkt schreiben + TASK_STATUS done=true. KEINE selbst-verifikation.",
    "  (build-gate läuft server-seitig nach deinem done=true.)",
    "- wenn 60s vergangen sind ohne dass die file geschrieben ist:",
    "  STOP, schreibe sie jetzt, dann TASK_STATUS — du bist abgedriftet.",
    "",
    "🚫 HARTE VERBOTE (sofort done=false + summary 'verboten: ...'):",
    "- `git commit`, `git push`, `git tag`, `git rebase`, `git reset --hard`,",
    "  `git checkout -- <file>`, `git stash` — der SERVER commitet selber nach",
    "  deinem done=true. du darfst NIEMALS selber commiten oder history",
    "  manipulieren — auch nicht wenn es 'aufräumend' wirkt.",
    "- chrome-devtools-mcp / puppeteer / mcp-fetch / shell-fetcher (curl,",
    "  wget, Invoke-RestMethod, iwr, Invoke-WebRequest) auf localhost:*,",
    "  127.0.0.1:*, [::1]:* — außer wenn die aufgabe EXPLIZIT ein page-test",
    "  verlangt. synonym-tricks zählen als verstoß.",
    "- `tail`/`Get-Content` auf logs außerhalb des project-paths.",
    "- modifikation von dateien die NICHT in der AUFGABE genannt sind.",
    "- starten/stoppen von dev-servern, prozessen, ports.",
    "- änderungen die nicht im task-text stehen — auch nicht 'als bonus'.",
    retryContext ? "\n⚠️ DIES IST EIN RETRY (versuch " + retryContext.attempt + "/" + MAX_CC_RETRIES + "). VORHERIGER VERSUCH FEHLGESCHLAGEN:\n" +
      "Gate: " + retryContext.kind + " (exit " + (retryContext.exitCode ?? "?") + ")\n" +
      "Fehlerausgabe (letzte zeilen):\n```\n" + retryContext.output.split(/\r?\n/).slice(-30).join("\n") + "\n```\n" +
      "FIX den konkreten fehler, mach den task NICHT von vorne. " +
      "ABSOLUT VERBOTEN als 'fix': --no-verify, --skip-tests, eslint-disable, " +
      "@ts-ignore, test-xfail/skip, regeln deaktivieren, `as any`/`dynamic`. " +
      (retryContext.attempt >= 2
        ? "ZWEITER+ retry: wenn du den fehler nicht klar verstanden hast, lies " +
          "die relevanten files NEU (auch tests), und erkläre im summary WAS der " +
          "root cause war, bevor du fixt. Symptom-fix akzeptieren wir nicht."
        : "")
      : "",
    "",
    "Du DARFST und SOLLST Dateien lesen und schreiben (bypassPermissions ist aktiv)",
    "um die Aufgabe zu erledigen. Halte alle aktiven Regeln strikt ein.",
    "",
    "OUTPUT-BUDGET (wichtig — token + zeit sparen):",
    "  - TASK_PLAN: max 6 schritte, je ein satz.",
    "  - tool-aufrufe: kein meta-talk vor/nach. einfach machen.",
    "  - TASK_STATUS.summary: max 200 zeichen (was du getan hast).",
    "  - kein 'lass mich das jetzt tun…' / 'ich werde nun…' — direkt handeln.",
    "  - keine wiederholungen vom prompt-content im output.",
    "  - bei großen file-changes: NICHT den ganzen file-content zitieren.",
    "",
    "BLOCKER-RESOLUTION (wichtig wenn du auf hindernisse stößt):",
    "  - Build/test/lint fehler → fixe die URSACHE im code, NICHT umgehen.",
    "    NIEMALS: `--no-verify`, `// eslint-disable`, test-skip/xfail ohne",
    "    bug-ticket, `@ts-ignore` ohne kommentar warum, regeln deaktivieren.",
    "  - Fehlende dependency → installieren (npm/pub/cargo add), commit mit pkg.",
    "  - Type-error → echten typ fixen, kein `as any` / `dynamic` ohne grund.",
    "  - Test failt → erst test lesen + verstehen WAS er prüft, dann production",
    "    code anpassen. Test ÄNDERN nur wenn du erklären kannst warum die",
    "    erwartung falsch war (summary muss das nennen).",
    "  - Konflikt mit einer aktiven REGEL → halte die regel ein, finde anderen",
    "    weg. NIEMALS regel deaktivieren um deinen weg zu rechtfertigen.",
    "  - Hard-block (z.b. fehlende API, externe service down) → done=false mit",
    "    KLARER fehler-beschreibung im summary. NICHT vorgaukeln.",
    "  - TOOL FEHLT AM SYSTEM (z.b. flutter, npm, python, cargo, claude-cli):",
    "    1× via Bash prüfen (`where flutter` / `which flutter`).",
    "    wenn definitiv nicht gefunden → SOFORT abort mit done=false +",
    "    klarer summary: 'flutter SDK fehlt — installieren: <link>'.",
    "    NIEMALS endlos suchen / immer wieder verschiedene pfade probieren.",
    "    NIEMALS retry-loops bei tool-missing (das fixt sich nicht von selbst).",
    "    bekannte fehl-installation-meldungen:",
    "    - 'flutter SDK fehlt — https://docs.flutter.dev/get-started/install'",
    "    - 'node/npm fehlt — https://nodejs.org/de/download/'",
    "    - 'python3 fehlt — https://www.python.org/downloads/'",
    "    - 'cargo/rust fehlt — https://rustup.rs'",
    "",
    "SELBST-VERIFIKATION (du SOLLST nach jeder änderung verifizieren):",
    "  - code-änderung → Bash-tool: passenden test/lint/build laufen lassen",
    "    (npm test, flutter analyze, cargo check, pytest, etc.)",
    "  - server-/backend-änderung → Bash: server kurz starten + curl /health",
    "  - UI-/frontend-änderung → puppeteer-MCP: page öffnen + screenshot/dom-check",
    "  - script-/CLI-änderung → code-runner-MCP oder Bash: echtes execution-result",
    "  - dependencies → Bash: install + import-check",
    "Ohne verifikation darfst du NICHT done=true melden. Wenn die verifikation",
    "fehlschlägt, fixe den fehler im selben turn und verifiziere nochmal — keine",
    "done=true mit 'sollte gehen'.",
    "Server fährt automatisch build-gate (analyze/test) UND runtime-test",
    "(server-spawn + /health) NACH deinem done=true. Wenn dein code DAS nicht",
    "übersteht, kommt der retry mit fehler-context zurück.",
    "",
    "VERFÜGBARE MCP-tools (zusätzlich zu Read/Edit/Write/Bash/Glob/Grep):",
    "  filesystem, sequential-thinking, context7 (lib-docs), puppeteer (browser),",
    "  code-runner (run snippets), fetch (HTTP), github (issues/PRs falls token),",
    "  memory (knowledge-graph cross-session).",
    "",
    "SUB-AGENTS (Task-tool): PFLICHT bei nontrivialem scope. Spawne sub-",
    "agenten via Task-tool statt selber linear durchzuarbeiten — sonst",
    "verbrennst du tokens für context den du nicht brauchst.",
    "  WANN sub-agent: ",
    "  - mehrere files zu lesen/scannen → Explore-agent ALLE auf einmal",
    "  - 2+ unabhängige changes → 1 sub-agent pro change, parallel",
    "  - großer codeblock zu refactoren → general-purpose mit klarem scope",
    "  - audit über >3 files → general-purpose-agent",
    "  WANN NICHT sub-agent:",
    "  - trivial 1-file edit (z.b. nur einen typo fixen)",
    "  - du brauchst den vollen state für decisions (selten)",
    "  REGELN:",
    "  - jeder sub-agent-prompt MUSS self-contained (kein 'wie besprochen')",
    "  - exakte file-paths + erwartetes return-format vorgeben",
    "  - bei N unabhängigen tasks: ALLE Task-calls IN EINER message parallel",
    "  - sub-agent erbt NICHT deinen context — gib ihm was er braucht.",
    "  TOKEN-EFFIZIENZ:",
    "  - sub-agents lesen nur was sie brauchen → 10× weniger input-tokens",
    "  - parallel statt sequenziell → schneller fertig",
    "  - dein hauptkontext bleibt klein für die finale entscheidung",
    "",
    "Gib AM ANFANG deiner Antwort einen Plan aus (3-6 konkrete Schritte),",
    "AM ENDE den Status. Format (keine Markdown-Fencing):",
    "",
    "1) Plan AM ANFANG:",
    "<<<TASK_PLAN",
    '{"steps":["1. Theme-File anlegen","2. Toggle-Widget bauen","3. AppBar einbauen"]}',
    ">>>",
    "",
    "2) Status AM ENDE:",
    "<<<TASK_STATUS",
    '{"done":true|false,"summary":"kurzer 1-zeilen-zusammenfassung","filesChanged":["..."]}',
    ">>>",
    "",
    "3) Optional Regel-Vorschläge AM ENDE:",
    "<<<RULE_SUGGESTIONS",
    '{"add":[{"category":"code-stil|architektur|workflow","text":"..."}],"deactivate":["regel-text"],"activate":["regel-text"]}',
    ">>>",
    "",
    "WICHTIG zu RULE_SUGGESTIONS.add: NUR universelle Verhaltens-/Stilregeln,",
    "die für JEDE zukünftige aufgabe gelten. KEINE task-spezifischen TODOs,",
    "keine konkreten dateinamen/modulpfade, keine 'X anlegen/splitten/refactoren'.",
    "Beispiele Regel: 'tests vor implementation', 'snake_case für dateien'.",
    "Beispiele NICHT-Regel (gehören in TASK_STATUS/Ideen): 'rule-diff-modul",
    "anlegen', 'store.json zu sqlite migrieren'.",
    "",
    'done=true: aufgabe ist fertig. done=false: blockiert/teilweise. Falls keine Regel-Vorschläge: {"add":[]}.',
    "",
    "4) RÜCKFRAGEN sind STARK eingeschränkt. NIEMALS fragen für:",
    "   - „aufgabe zu groß, wo soll ich anfangen?\" → ZERLEGE SELBST: wähle",
    "     den kleinsten konkreten teilschritt (max 1-2h arbeit), arbeite daran,",
    "     markiere im summary welchen teilschritt du gerade gemacht hast.",
    "     ODER: dispatch sub-agenten (Task-tool) parallel für klar trennbare",
    "     teile — siehe SUB-AGENTS oben. NIE wegen scope fragen.",
    "   - tech-stack / naming / file-struktur → nimm die offensichtliche option",
    "     (das was schon im projekt ist, sonst flutter/dart-defaults), commit",
    "     dich + mach.",
    "   - „soll ich a, b oder c machen?\" → wähle a, mach a, fertig.",
    "",
    "   Du DARFST eine QUESTION stellen NUR wenn du eine EXTERNE entscheidung",
    "   brauchst, die der user wirklich beantworten muss (z.B. API-key, design-",
    "   richtung, business-logik die nicht aus rules/goals ableitbar ist):",
    "<<<QUESTION",
    "Deine konkrete frage in 1-3 sätzen.",
    ">>>",
    "   Wenn du fragst: done=false UND beschreibe im summary WAS du bis dahin",
    "   schon erledigt hast (kein leerer commit!).",
  ].filter(Boolean).join("\n");

  // Claude CLI binary über zentralen helper resolven (deckt npm-global UND
  // Anthropic-standalone-installer in ~/.local/bin/claude.exe ab).
  const claudeBin = resolveClaudeBinary();
  console.log("[cc] using claude bin:", claudeBin);

  // Prompt in temporärer Datei → claude mit -p "@file" oder via stdin pipe.
  // Stdin ist robuster auf Windows als ein cmd-Arg mit Newlines/Umlauten.
  // MCP-Konfig: gibt claude Zugriff auf filesystem, sequential-thinking,
  // context7 (lib-docs), puppeteer (browser-automation), code-runner,
  // ref-tools. Konfig liegt neben server.js.
  // Model-routing: sonnet-4-6 default (schnell+billig), opus-4-7 nur wenn
  // big-signatur (architektur, refactor, retry, hohe priority). spart bei
  // 80%+ der tasks token-cost-ratio von ~3× (opus zu sonnet).
  const selectedModel = selectModelForTask({
    task,
    retryAttempt: retryContext?.attempt || 0,
    // user-prompt (nicht fullPrompt). fullPrompt enthält ~2500 zeichen
    // guardrail-text und würde jeden manual-/api/cc/run auf opus eskalieren,
    // auch für trivial-writes wie "erstelle RUN3.md mit fertig".
    prompt,
  });
  // MCP-Konfig dynamisch auflösen: tier-basierte allowlist (kleine tasks
  // brauchen nicht puppeteer+github+code-runner+fetch — spart 6-8 server
  // × ~1s startup + ~7000 schema-tokens pro spawn). standard für sonnet-4.6,
  // full für opus-4.7.
  // Trivial-write-detection: kurze write-task → restricted tool-set
  // (KEIN Bash/PowerShell). cc kann sich dann nicht in seitenarbeit
  // (git, curl, Get-Process, start-server) verlieren — es BLEIBT auf
  // file-operations beschränkt. selbst-verifikation läuft server-seitig.
  const _descShort = (task?.description || "").trim();
  const _titleLower = (task?.title || "").toLowerCase();
  // bei freiem /api/cc/run (kein task) auf prompt-text zurückfallen — sonst
  // bleibt trivial-detection bei manual-runs immer leer und fetcht-MCP/full-
  // tool-set wird unnötig aktiv.
  const _trivialBlob = task ? (_descShort + " " + _titleLower)
                            : (typeof prompt === "string" ? prompt.trim() : "");
  const isTrivialWriteTask = _trivialBlob.length > 0 &&
    _trivialBlob.length < 300 &&
    /^\s*(erstelle|schreibe|lege an|create|write|f[uü]ge|add)\b/i.test(_trivialBlob);

  const mcpTier = isTrivialWriteTask ? "minimal" :
                  (selectedModel === "claude-opus-4-7" ? "full" : "standard");
  const mcpConfigPath = resolveMcpConfig({ baseDir: __dirname, tier: mcpTier });
  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--dangerously-skip-permissions",
    // --strict-mcp-config: ignoriere user-level MCP-config (~/.claude/plugins/),
    // verwende NUR unser --mcp-config. verhindert dass chrome-devtools-mcp,
    // puppeteer-plugin etc cc auto-injizieren und mit fremdtools in seiten-
    // arbeit verfallen.
    "--strict-mcp-config",
    "--model", selectedModel,
    "--add-dir", cwd,
    // Hard-Budget pro Task (Sicherung gegen Runaway)
    "--max-budget-usd", String(state.ccBudget?.perTaskUsd ?? 2.0),
  ];
  if (isTrivialWriteTask) {
    // Trivial-write: NUR WebFetch/WebSearch sperren (Bash + Task brauchen wir
    // sehr wohl, sonst hängt cc in analyse statt write). chrome-devtools/
    // puppeteer-spam ist sowieso schon weg dank --strict-mcp-config.
    args.push("--disallowedTools", "WebFetch,WebSearch");
    console.log("[cc] trivial-write-mode: WebFetch/WebSearch blocked, rest ok");
  }
  // --continue: resume die LETZTE conversation im cwd, statt jedes mal
  // ne frische zu starten. effekt: API-prompt-cache (5min TTL) hits beim
  // 2.,3.,4. task derselben projekt-cwd → massive token-ersparnis bei
  // wiederholten cc-runs auf demselben projekt.
  // skip wenn retry (frischer context für retry, sonst trägt cc den alten
  // fehler durch) oder wenn manual /api/cc/run mit eigenem prompt.
  const isRetry = !!(retryContext && retryContext.attempt > 0);
  // --continue NUR wenn wir schon mal ne session im selben cwd hatten.
  // sonst: claude CLI "no conversations found" → cc bricht stumm ab und
  // der task hängt für immer in 'running'.
  // --continue: in-memory-set (gleicher server-run) ODER persistierte
  // claude-history auf platte (server-restart-tolerant).
  if (!isRetry && task && !prompt &&
      (ccProjectsWithSession.has(cwd) || _hasClaudeHistoryFor(cwd))) {
    args.push("--continue");
  }
  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
  }

  // Defense-in-depth: cwd kann aus persistierter state.json stammen, die
  // vor dem PATCH_PROJECT-Validator gespeichert wurde. Vor spawn nochmal
  // hart prüfen, da shell:true den Pfad durch cmd.exe leitet.
  assertSafeProjectPath(cwd, "claude.cwd");
  let proc;
  try {
    proc = spawn(claudeBin, args, {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...userSettings.envOverlay() },
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  } catch (e) {
    const err = new Error("claude CLI nicht startbar: " + e.message);
    err.status = 500;
    throw err;
  }

  // Task 3: parser für stream-json. Hält line-buffer, liefert events.
  const streamParser = createStreamJsonParser();
  const job = {
    // FIX #3: projectId direkt am job-objekt — _handleCcStreamEvent braucht
    // ihn ohne ccJobs-iteration. Auch bug-resistant gegen flush nach delete.
    projectId, proc, startedAt: NOW(), taskId, prompt: fullPrompt, lines: [], cwd,
    model: selectedModel, // für metrics + activity-log
    // Stream-json gefiltert: nur assistant text-content → für regex-parser
    // (TASK_PLAN/TASK_STATUS/RULE_SUGGESTIONS/QUESTION) am ende.
    assistantText: "",
    // Tool-use-events für UI-history (begrenzt auf 200, älteste fliegen).
    toolEvents: [],
    realUsage: null, // wird aus result-event gefüllt
  };
  ccJobs.set(projectId, job);
  console.log("[cc] start", projectId, "in", cwd, "task:", task?.title || prompt);

  // Activity-Eintrag „Cloud-Code gestartet"
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: "info",
    text: "cloud-code gestartet" + (task ? ": <i>" + escapeHtml(task.title) + "</i>" : "") +
          " · model: <code>" + (selectedModel === "claude-opus-4-7" ? "opus-4.7" : "sonnet-4.6") + "</code>",
  }});
  applyMutation("ADD_SYNC_LOG", { entry: {
    source: "cloud", projectId,
    text: "cc gestartet" + (task ? `: <i>${escapeHtml(task.title)}</i>` : ""),
  }});
  broadcastState();
  broadcastForProject({ type: "CC_STATUS", projectId, status: ccStatus(projectId) }, projectId);
  // „Claude denkt nach"-indicator: solange noch nichts aus stdout kam, alle
  // 1.5s einen CC_THINKING-frame senden — UI rendert daraus den typing-dot.
  let thinkingTimer = setInterval(() => {
    if (job.lines.length === 0 || job.lines.join("").trim().length < 5) {
      broadcastForProject({ type: "CC_THINKING", projectId, since: job.startedAt }, projectId);
    } else {
      clearInterval(thinkingTimer); thinkingTimer = null;
    }
  }, 1500);
  job._thinkingTimer = thinkingTimer;

  // Task 3: stream-json stdout-handler. Pro event entscheiden wir was zu tun
  // ist; alles strukturiert, kein regex-fishing mehr im rohstream.
  proc.stdout.on("data", (chunk) => {
    job.lines.push(chunk.toString()); // raw fallback für debug
    const events = streamParser.feed(chunk.toString());
    for (const ev of events) {
      _handleCcStreamEvent(job, ev);
    }
    if (events.length > 0) broadcastState();
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    job.lines.push("[stderr] " + text);
    broadcastForProject({ type: "CC_OUTPUT", projectId, chunk: text, stream: "stderr" }, projectId);
  });

  proc.on("close", (code) => {
    // FIX #2+#3: flush VOR ccJobs.delete machen wir nicht mehr nötig
    // (job.projectId ist jetzt direkt am job), aber thinking-timer kann weg.
    if (job._thinkingTimer) { clearInterval(job._thinkingTimer); job._thinkingTimer = null; }

    // Flush parser FIRST damit letzte events (oft result mit echten tokens)
    // noch ankommen. _handleCcStreamEvent nutzt job.projectId, daher
    // unabhängig von ccJobs-state.
    for (const ev of streamParser.flush()) _handleCcStreamEvent(job, ev);

    ccJobs.delete(projectId);
    cleanupResolvedConfig(mcpConfigPath);
    // Session-marker: wenn cc tatsächlich gestartet ist (realUsage da ODER
    // wir text gesehen haben), gibt es jetzt eine resumable conversation
    // im cwd → ab jetzt darf --continue benutzt werden.
    if (job.realUsage || (job.assistantText && job.assistantText.length > 0)) {
      ccProjectsWithSession.add(cwd);
    }
    console.log("[cc] done", projectId, "exit", code);
    // Wenn KEIN done=true tail folgt (z.b. done=false, crash, question),
    // wird der release weiter unten nicht hinkommen. Daher hier proaktiv
    // den autopump anstoßen — wenn ein tail folgt, locked _ccPostChecks
    // den autopump weiter.
    _triggerAutoPumpNow();

    // FIX #9: pending tool_use-events ohne result → "cancelled" markieren,
    // sonst bleiben sie für immer "running" in der UI.
    for (const te of (job.toolEvents || [])) {
      if (te.state === "running") {
        te.state = "cancelled";
        broadcastForProject({
          type: "CC_TOOL_EVENT", projectId,
          phase: "result", id: te.id, tool: te.tool,
          isError: false, brief: "cancelled (cc beendet)", ts: NOW(),
        }, projectId);
      }
    }
    // FIX #18: thinking-text clearen damit UI nicht ewig „💭 …" zeigt
    broadcastForProject({ type: "CC_THINKING_TEXT", projectId, text: "" }, projectId);

    // Für die regex-parser unten: assistant-text aus stream-json
    // (statt rohstdout — der ist jetzt jsonl, regex würde fehlschlagen)
    const fullOutput = job.assistantText || job.lines.join("");

    // Claude-API-Limit erkennen → Auto-Pump für 10 Minuten pausieren.
    // BUG-FIX: die alte regex /hit your limit|rate limit|usage limit/i
    // hat false-positive auf normalen cc-output gematcht — z.B. tasks
    // mit titel "add rate-limit middleware" oder code-kommentare über
    // rate-limiting → autopump pausiert ohne grund 10min. jetzt nur noch
    // unzweideutige Anthropic-API-error-patterns (json error-type,
    // 429-status, spezifische CLI-fehlermeldungen).
    // Auch wichtig: stderr (lines) prüfen ist sinnvoll — assistantText
    // (fullOutput) ist content, der cc generiert hat → enthält bei
    // normalen tasks oft "rate limit" als ganz normalen begriff.
    const stderrText = job.lines.join("");
    const apiLimitRegex = /("type"\s*:\s*"rate_limit_error")|(\brate_limit_error\b)|(\b429\s+(too many|rate)\b)|(\bhit your (usage|API|monthly) limit\b)|(\bquota exceeded\b)|(\byou.?ve (used|reached) your (usage|monthly|API)\b)/i;
    if (apiLimitRegex.test(stderrText) || (job.realUsage === null && apiLimitRegex.test(fullOutput))) {
      _ccApiLimitedUntil = NOW() + 10 * 60 * 1000;
      console.log("[autopump] claude API limited — pausiere bis", new Date(_ccApiLimitedUntil).toLocaleTimeString());
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "warn",
        text: "claude-api limit erreicht · auto-pump pausiert für 10min — im cloud-code-tab gibt es einen 'fortsetzen jetzt'-button",
      }});
      // ccApiLimitedUntil wird in publicState() injiziert (transient,
      // NICHT persistent), damit nach server-restart kein stale-flag bleibt.
    }

    // Task 3: ECHTE token-zahlen aus result-event statt char/4-schätzung.
    // Fallback: alte schätzung wenn result fehlte (z.b. crash vor result).
    let inputTokens, outputTokens, estCostUsd, cacheCreated, cacheRead;
    if (job.realUsage) {
      inputTokens = job.realUsage.tokensIn;
      outputTokens = job.realUsage.tokensOut;
      cacheCreated = job.realUsage.cacheCreated;
      cacheRead = job.realUsage.cacheRead;
      estCostUsd = typeof job.realUsage.costUsd === "number" ? job.realUsage.costUsd : 0;
    } else {
      inputTokens = Math.round(fullPrompt.length / 4);
      outputTokens = Math.round(fullOutput.length / 4);
      cacheCreated = 0; cacheRead = 0;
      const PRICE_IN = 3.0 / 1_000_000, PRICE_OUT = 15.0 / 1_000_000;
      estCostUsd = inputTokens * PRICE_IN + outputTokens * PRICE_OUT;
    }
    const durationMs = NOW() - job.startedAt;

    // Globaler Tracker
    if (!state.ccBudget) state.ccBudget = { totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, perTaskUsd: 2.0, jobs: [] };
    state.ccBudget.totalTokensIn += inputTokens;
    state.ccBudget.totalTokensOut += outputTokens;
    state.ccBudget.totalCostUsd += estCostUsd;
    state.ccBudget.jobs = [
      { projectId, taskId, ts: NOW(), inputTokens, outputTokens,
        cacheCreated, cacheRead, costUsd: estCostUsd, durationMs,
        ok: code === 0, real: !!job.realUsage, model: job.model || null },
      ...(state.ccBudget.jobs || []),
    ].slice(0, 100);

    const cacheTxt = cacheCreated || cacheRead
      ? ` · cache: ${(cacheCreated/1000).toFixed(1)}k created · ${(cacheRead/1000).toFixed(1)}k read`
      : "";
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "info",
      text: `tokens: ${inputTokens.toLocaleString("de")} in · ${outputTokens.toLocaleString("de")} out · $${estCostUsd.toFixed(4)}${job.realUsage ? "" : " (geschätzt)"} · ${(durationMs/1000).toFixed(1)}s${cacheTxt}`,
    }});

    // QUESTION-Block: claude hat rückfrage → in project.pendingQuestion speichern,
    // UI rendert sie als widget oberhalb des cc-prompts.
    const qm = fullOutput.match(/<<<QUESTION\s*([\s\S]*?)\s*>>>/);
    if (qm && qm[1].trim()) {
      const qText = qm[1].trim().slice(0, 1000);
      applyMutation("SET_PENDING_QUESTION", { projectId, question: qText, taskId });
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "info", text: "claude fragt zurück: <i>" + escapeHtml(qText.slice(0, 120)) + "</i>",
      }});
      emitPush({ type: "cc_question", projectId, question: qText });
    }

    // TASK_STATUS-Block parsen → wenn done=true und es gibt task → erst
    // SELF-REVIEW, dann markiere als done (oder lasse offen bei issues)
    const ts = fullOutput.match(/<<<TASK_STATUS\s*([\s\S]*?)\s*>>>/);
    let parsedStatus = null;
    if (ts && ts[1].trim()) {
      try { parsedStatus = JSON.parse(ts[1].trim()); }
      catch (e) { console.log("[cc] could not parse TASK_STATUS:", e.message); }
    }

    if (parsedStatus && Array.isArray(parsedStatus.filesChanged) && parsedStatus.filesChanged.length) {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "write",
        text: `cc berührte ${parsedStatus.filesChanged.length} datei(en): <code>${parsedStatus.filesChanged.slice(0,5).map(escapeHtml).join("</code>, <code>")}</code>`,
      }});
    }

    if (parsedStatus && parsedStatus.done === true && taskId) {
      // ─── BUILD-GATE + FAILURE-LOOP ─────────────────────────
      // Lock: autopump soll während build-gate/runtime/review NICHT einen
      // neuen task auf diesem projekt picken (sonst crasht der retry mit
      // "läuft bereits"). _ccPostChecks.delete passiert in der release-
      // funktion am ende aller pfade (success, retry, max-retry).
      _ccPostChecks.add(projectId);
      _ccPostCheckStartedAt.set(projectId, NOW());
      const releasePostCheck = () => {
        _ccPostChecks.delete(projectId);
        _ccPostCheckStartedAt.delete(projectId);
        // sofort den nächsten task starten — kein 25s-warten mehr
        _triggerAutoPumpNow();
      };

      // OPTIMIERUNG: skip build-gate komplett wenn cc 0 dateien geändert
      // hat. read-only/analyse-tasks brauchen keine echte verifikation —
      // genau wie self-review schon geskippt wird. spart 30-180s pro task.
      const filesChangedList = Array.isArray(parsedStatus.filesChanged) ? parsedStatus.filesChanged : [];
      if (filesChangedList.length === 0) {
        // GUARD: wenn der task-text explizit nach einer datei verlangt
        // (erstelle/schreibe/lege an/create/write/...), darf der read-only-
        // skip-pfad NICHT auto-checkmark feuern. Sonst markiert cc tasks als
        // done obwohl die geforderte datei nie geschrieben wurde.
        const tnPre = state.projects.find(p => p.id === projectId)?.tasks.find(t => t.id === taskId);
        const taskText = ((tnPre?.title || "") + " " + (tnPre?.description || "")).toLowerCase();
        const requiresWrite = /\b(erstelle|erstellen|schreibe|schreib|schreiben|lege an|anlegen|generiere|generieren|create|write|implement|implementiere|implementieren|baue|bauen|hinzuf[uü]gen|hinzuf[uü]ge|add )\b/.test(taskText);
        if (requiresWrite) {
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "warn",
            text: `cc behauptet done — aber 0 dateien geändert obwohl task ausdrücklich eine datei verlangt. NICHT auto-checkmark.`,
          }});
          applyMutation("ADD_SYNC_LOG", { entry: {
            source: "cloud", projectId,
            text: `cc-task „${escapeHtml((tnPre?.title || "").slice(0,80))}" verifikation: keine datei erstellt — task bleibt offen`,
          }});
          // Retry-counter erhöhen damit autopump beim nächsten anlauf einen
          // schärferen prompt mitgibt (oder nach max-retry FAILED markiert).
          const prev = _ccRetryContext.get(taskId) || { attempt: 0, kind: "missing-write", projectId };
          _ccRetryContext.set(taskId, {
            ...prev, attempt: (prev.attempt || 0) + 1,
            kind: "missing-write",
            lastNote: "cc claimed done but wrote 0 files; task description requires file creation",
            projectId,
          });
          releasePostCheck();
          return;
        }
        applyMutation("ADD_ACTIVITY", { projectId, event: {
          type: "info",
          text: "build-gate + runtime-test übersprungen (0 dateien geändert)",
        }});
        const tn = state.projects.find(p=>p.id===projectId)?.tasks.find(t=>t.id===taskId);
        if (tn) {
          (tn.subtasks || []).filter(s => !s.done).forEach(s => {
            applyMutation("TOGGLE_SUBTASK", { projectId, taskId, subtaskId: s.id });
          });
          applyMutation("SET_TASK_DONE", { projectId, taskId, done: true });
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "check",
            text: `cc auto-checkmark: <i>${escapeHtml(tn.title)}</i>` +
                  (parsedStatus.summary ? ` · ${escapeHtml(parsedStatus.summary)}` : "") +
                  " · (read-only, gates übersprungen)",
          }});
          _ccRetryContext.delete(taskId);
          broadcastState();
        }
        releasePostCheck();
        return;
      }

      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "info",
        text: `build-gate läuft (${project.tech || "?"}) …`,
      }});
      broadcastState();

      // OPTIMIERUNG: build-gate + runtime-test parallel laufen (statt
      // sequentiell). build-gate prüft lint/typecheck, runtime-test prüft
      // ob der server hochkommt — unabhängige checks. Wenn beide fehlen
      // schlagen, wird der retry-counter nur EINMAL inkrementiert (build
      // hat priorität als fehler-context, weil aussagekräftiger).
      Promise.all([
        runBuildGate({ projectPath: project.path }),
        runRuntimeTest({
          projectPath: project.path,
          filesChanged: parsedStatus.filesChanged || [],
        }).catch(e => ({ ok: true, skipped: true, kind: "error", output: e && e.message })),
      ]).then(async ([gate, rtResult]) => {
        const projNow = state.projects.find(p => p.id === projectId);
        const taskNow = projNow && projNow.tasks.find(t => t.id === taskId);
        if (!taskNow) {
          // BUG-FIX: vorher kein release → autopump für immer skip auf das
          // projekt. jetzt: release + log warum.
          console.log("[cc-tail] task verschwunden — release lock", projectId, taskId);
          releasePostCheck();
          return;
        }

        if (gate.skipped) {
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "info",
            text: "build-gate übersprungen (keine bekannte project-tech)",
          }});
        } else if (gate.ok) {
          // Gate grün → retry-state clearen, self-review startet
          _ccRetryContext.delete(taskId);
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "check",
            text: `build-gate ok (${gate.kind}, ${(gate.durationMs/1000).toFixed(1)}s)`,
          }});
        } else {
          // Gate rot → failure-loop
          const prev = _ccRetryContext.get(taskId);
          const attempt = (prev?.attempt || 0) + 1;
          const reason = gate.timedOut ? "timeout"
                       : gate.commandMissing ? "tool fehlt (" + gate.kind + ")"
                       : "exit " + gate.exitCode;
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "warn",
            text: `build-gate <strong>FAIL</strong> (${gate.kind} · ${reason}, ${(gate.durationMs/1000).toFixed(1)}s)`,
          }});
          if (attempt < MAX_CC_RETRIES && !gate.commandMissing) {
            // Retry: error-context speichern, gleichen task nochmal triggern.
            // _ccPostChecks bleibt LOCKED bis triggerCc seine ccJobs.set
            // gemacht hat — so kann autopump in den 3s nicht einen
            // konkurrierenden task auf demselben projekt starten.
            _ccRetryContext.set(taskId, {
              attempt, kind: gate.kind, exitCode: gate.exitCode,
              output: gate.output, projectId,
            });
            applyMutation("ADD_ACTIVITY", { projectId, event: {
              type: "info",
              text: `cc retry ${attempt}/${MAX_CC_RETRIES} startet in 3s mit fehler-context…`,
            }});
            broadcastState();
            setTimeout(() => {
              if (!state.ccRunning) {
                console.log("[cc-retry] skip — cc inzwischen pausiert");
                releasePostCheck();
                return;
              }
              triggerCc(projectId, taskId, null)
                .then(() => { _ccPostChecks.delete(projectId); }) // ccJobs hat den lock jetzt
                .catch((e) => {
                  console.log("[cc-retry] trigger fehler:", e.message);
                  releasePostCheck();
                });
            }, 3000);
            return; // KEIN self-review, kein checkmark
          }
          // Max retries (oder tool fehlt) → task bleibt offen, in_progress, mit warnung
          _ccRetryContext.delete(taskId);
          applyMutation("EDIT_TASK", { projectId, taskId, patch: {
            meta: (taskNow.meta ? taskNow.meta + " · " : "") + `blockiert (build-gate fail ${attempt}×)`,
          }});
          applyMutation("ADD_SYNC_LOG", { entry: {
            source: "cloud", projectId,
            text: `cc max-retries auf <i>${escapeHtml(taskNow.title)}</i>: build-gate ${attempt}× rot`,
          }});
          broadcastState();
          releasePostCheck();
          return; // wieder kein self-review
        }

        // ─── RUNTIME-TEST (Task 4) ────────────────────────────
        // ist bereits via Promise.all parallel zum build-gate gelaufen (siehe oben),
        // rtResult ist im destructuring schon enthalten. Hier nur noch auswerten.
        if (rtResult.skipped) {
          // skip → kein log-eintrag (würde nur spammen)
        } else if (rtResult.ok) {
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "check",
            text: `runtime ok (${rtResult.kind}, ${(rtResult.durationMs/1000).toFixed(1)}s)`,
          }});
        } else {
          // runtime fail → identische failure-loop wie build-gate
          const prev = _ccRetryContext.get(taskId);
          const attempt = (prev?.attempt || 0) + 1;
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "warn",
            text: `runtime <strong>FAIL</strong> (${rtResult.kind}, ${(rtResult.durationMs/1000).toFixed(1)}s)`,
          }});
          if (attempt < MAX_CC_RETRIES) {
            _ccRetryContext.set(taskId, {
              attempt, kind: "runtime-" + rtResult.kind, exitCode: null,
              output: rtResult.output, projectId,
            });
            applyMutation("ADD_ACTIVITY", { projectId, event: {
              type: "info",
              text: `cc retry ${attempt}/${MAX_CC_RETRIES} startet in 3s (runtime-fail)…`,
            }});
            broadcastState();
            setTimeout(() => {
              if (!state.ccRunning) {
                console.log("[cc-runtime-retry] skip — cc inzwischen pausiert");
                releasePostCheck();
                return;
              }
              triggerCc(projectId, taskId, null)
                .then(() => { _ccPostChecks.delete(projectId); })
                .catch((e) => {
                  console.log("[cc-runtime-retry] trigger fehler:", e.message);
                  releasePostCheck();
                });
            }, 3000);
            return; // kein self-review, kein checkmark
          }
          // FIX #1: `tn` war nicht im scope — `taskNow` ist die richtige variable
          _ccRetryContext.delete(taskId);
          applyMutation("EDIT_TASK", { projectId, taskId, patch: {
            meta: (taskNow.meta ? taskNow.meta + " · " : "") + `blockiert (runtime fail ${attempt}×)`,
          }});
          applyMutation("ADD_SYNC_LOG", { entry: {
            source: "cloud", projectId,
            text: `cc max-retries auf <i>${escapeHtml(taskNow.title)}</i>: runtime ${attempt}× rot`,
          }});
          broadcastState();
          releasePostCheck();
          return;
        }

        // ─── SELF-REVIEW (gate grün, runtime grün) ────────────
        // Optimierung: skip self-review wenn cc 0 dateien geändert hat —
        // bei reinen analyse-tasks (research/summary) ist review redundant
        // und kostet einen zweiten claude-call (~5-15s + tokens).
        const filesChanged = Array.isArray(parsedStatus.filesChanged) ? parsedStatus.filesChanged : [];
        const skipReview = filesChanged.length === 0;
        const reviewPromise = skipReview
          ? Promise.resolve({ ok: true, issues: [], confidence: 0.9, skipped: true })
          : runSelfReview(project, taskId, parsedStatus, fullOutput);
        if (skipReview) {
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "info",
            text: "self-review übersprungen (0 dateien geändert)",
          }});
        }
        reviewPromise.then(review => {
          const tn = state.projects.find(p=>p.id===projectId)?.tasks.find(t=>t.id===taskId);
          if (!tn) return;
          if (review.ok) {
            (tn.subtasks || []).filter(s => !s.done).forEach(s => {
              applyMutation("TOGGLE_SUBTASK", { projectId, taskId, subtaskId: s.id });
            });
            applyMutation("SET_TASK_DONE", { projectId, taskId, done: true });
            applyMutation("ADD_ACTIVITY", { projectId, event: {
              type: "check",
              text: `cc auto-checkmark: <i>${escapeHtml(tn.title)}</i>` +
                    (parsedStatus.summary ? ` · ${escapeHtml(parsedStatus.summary)}` : "") +
                    ` · review ok (${Math.round(review.confidence * 100)}%)`,
            }});
            // Per-task git-commit (Task 7) — rollback-fähig, audit-trail.
            // Async, blockiert nicht; ergebnis als activity-event.
            if (gitIsRepo(project.path)) {
              gitCommitChanges({
                projectPath: project.path,
                message: "[cc] " + tn.title +
                  (parsedStatus.summary ? " · " + parsedStatus.summary.slice(0, 80) : ""),
                authorName: "cloud-code",
                authorEmail: "cc@projectgamma.local",
                // nur die files die cc selbst gemeldet hat — verhindert dass
                // user-in-progress-edits in den cc-commit reingezogen werden.
                filesChanged: Array.isArray(parsedStatus.filesChanged) ? parsedStatus.filesChanged : [],
              }).then((g) => {
                if (g.committed) {
                  applyMutation("ADD_ACTIVITY", { projectId, event: {
                    type: "info",
                    text: `git commit <code>${escapeHtml(g.sha)}</code>`,
                  }});
                  broadcastState();
                } else if (g.error) {
                  applyMutation("ADD_ACTIVITY", { projectId, event: {
                    type: "warn", text: `git-commit fehler: ${escapeHtml(g.error.slice(0, 200))}`,
                  }});
                  broadcastState();
                }
                // g.skipped: silent — kein commit, kein log-spam
              }).catch((e) => { console.log("[git] commit-error:", e && e.message); });
            }
            // Bug-auto-resolve: wenn cc files berührt hat, die auf eine pending-bug-location passen,
            // markiere die bugs als "potentially-fixed". User kann via UI bestätigen oder reopen.
            // 0 LLM-tokens — reine heuristik auf filesChanged ∩ bug.location.
            //
            // FIX #5: substring-match war zu greedy ("a.js" matchte alles mit ".js").
            // Jetzt: pfad-segment-vergleich (endsWith oder exact-match) + min-länge 6.
            if (Array.isArray(parsedStatus.filesChanged) && parsedStatus.filesChanged.length) {
              const proj = state.projects.find(p => p.id === projectId);
              const pendingBugs = (proj?.bugs || []).filter(b => b.status === "pending");
              const changedNorm = parsedStatus.filesChanged
                .map(f => String(f).replace(/\\/g, "/").toLowerCase().trim())
                .filter(f => f.length > 0);
              let resolved = 0;
              for (const b of pendingBugs) {
                if (!b.location) continue;
                // bug.location kann „file.js:42" sein → nur file-teil
                const locFile = b.location.replace(/\\/g, "/").toLowerCase().trim().split(":")[0];
                if (!locFile || locFile.length < 6) continue; // zu kurz → too-many-false-positives
                // Match wenn:
                //   - exakter pfad-match, ODER
                //   - changed-file endet mit "/" + locFile (locFile ist eine path-tail)
                //   - locFile endet mit "/" + changed-file (changed ist eine path-tail vom bug)
                const hit = changedNorm.some(f => {
                  if (f === locFile) return true;
                  if (f.endsWith("/" + locFile)) return true;
                  if (locFile.endsWith("/" + f) && f.length >= 6) return true;
                  return false;
                });
                if (hit) {
                  applyMutation("SET_BUG_STATUS", { projectId, bugId: b.id, status: "potentially-fixed" });
                  resolved++;
                }
              }
              if (resolved > 0) {
                applyMutation("ADD_ACTIVITY", { projectId, event: {
                  type: "check",
                  text: `${resolved} bug(s) als potentiell-fixed markiert (datei-overlap mit cc-änderung)`,
                }});
                broadcastState();
              }
            }
          } else {
            applyMutation("ADD_ACTIVITY", { projectId, event: {
              type: "warn",
              text: `cc self-review fand issues bei <i>${escapeHtml(tn.title)}</i>: ` +
                    review.issues.slice(0, 3).map(escapeHtml).join(" · "),
            }});
            applyMutation("ADD_SYNC_LOG", { entry: {
              source: "cloud", projectId,
              text: `cc self-review BLOCKIERT auto-checkmark (${review.issues.length} issue(s))`,
            }});
          }
          broadcastState();
          releasePostCheck(); // erfolgs-pfad: tail komplett, autopump kann nächsten task starten
        }).catch(e => {
          console.log("[selfreview] error:", e.message);
          applyMutation("SET_TASK_DONE", { projectId, taskId, done: true });
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "check",
            text: `cc auto-checkmark (review skipped: ${escapeHtml(e.message)})`,
          }});
          broadcastState();
          releasePostCheck();
        });
      }).catch(e => {
        // build-gate selbst crashed → fall through zu self-review (fail-open)
        console.log("[build-gate] error, fall-through:", e && e.message);
        applyMutation("ADD_ACTIVITY", { projectId, event: {
          type: "warn", text: `build-gate crash, übersprungen: ${escapeHtml(e.message || "?")}`,
        }});
        broadcastState();
        releasePostCheck();
      });
    }

    // Regel-Vorschläge aus claude-Output parsen (zwischen <<<RULE_SUGGESTIONS und >>>)
    const m = fullOutput.match(/<<<RULE_SUGGESTIONS\s*([\s\S]*?)\s*>>>/);
    let suggestionsApplied = 0;
    if (m && m[1].trim()) {
      try {
        const sugg = JSON.parse(m[1].trim());
        const proj = state.projects.find(p => p.id === projectId);
        if (proj) {
          // Neue Regeln klassifizieren: nur universelle Verhaltens-/Stilregeln
          // landen als ADD_RULE (active:false, cc-vorschlag). Task-artige
          // Texte (Datei-/Modulpfade, Action-verben, sehr lang) werden zu
          // ADD_IDEA umgeleitet — sonst füllt sich die Regelliste mit
          // episodischen TODOs (siehe bug-report vom user).
          let ruleTombs = (proj.removedRules || []).map(r => r.text.trim().toLowerCase());
          (sugg.add || []).forEach(r => {
            if (!r.text) return;
            const txt = r.text.trim();
            // Duplikat-check gegen aktive/inaktive Regeln + tombstones
            const txtLow = txt.toLowerCase();
            if (proj.rules.some(x => x.text.trim().toLowerCase() === txtLow)) return;
            if (ruleTombs.includes(txtLow)) return;
            const kind = classifyRuleOrIdea(txt);
            if (kind === "idea") {
              if (!(proj.ideas || []).some(i => (i.text || "").trim().toLowerCase() === txtLow)) {
                applyMutation("ADD_IDEA", { projectId, idea: {
                  text: txt, status: "unprocessed", source: "cloud-code", createdAt: NOW(),
                }});
                suggestionsApplied++;
              }
            } else {
              const cat = ["code-stil","architektur","workflow"].includes(r.category) ? r.category : "workflow";
              applyMutation("ADD_RULE", { projectId, rule: { category: cat, text: txt, active: false, suggestedBy: "cloud-code" }});
              suggestionsApplied++;
            }
          });
          // activate/deactivate werden NICHT direkt umgeschaltet, sondern
          // als pending-diff in die Queue gelegt (user bestätigt per checkmark).
          const before = (proj.ruleDiffs || []).filter(d => d.status === "pending").length;
          if ((sugg.deactivate && sugg.deactivate.length) || (sugg.activate && sugg.activate.length)) {
            applyMutation("ENQUEUE_RULE_DIFFS", { projectId, suggestion: { activate: sugg.activate, deactivate: sugg.deactivate } });
          }
          const projAfter = state.projects.find(p => p.id === projectId);
          const after = (projAfter && projAfter.ruleDiffs || []).filter(d => d.status === "pending").length;
          const enqueued = Math.max(0, after - before);
          suggestionsApplied += enqueued;
          if (suggestionsApplied) {
            applyMutation("ADD_ACTIVITY", { projectId, event: {
              type: "rule",
              text: `cloud-code regel-vorschläge: ${suggestionsApplied - enqueued} neu, ${enqueued} pending-diffs (warten auf checkmark)`,
            }});
          }
        }
      } catch (e) {
        console.log("[cc] could not parse rule suggestions:", e.message);
      }
    }

    // Auto-Mobile-Rebuild: wenn claude Files in mobile-app/ geändert hat,
    // baue automatisch das APK + installiere via adb (falls Phone per USB da).
    let willRebuild = false;
    if (code === 0 && parsedStatus && Array.isArray(parsedStatus.filesChanged)) {
      const mobileTouched = parsedStatus.filesChanged.some(f =>
        String(f).replace(/\\/g, "/").includes("mobile-app/"));
      if (mobileTouched) {
        willRebuild = true;
        rebuildMobileApp(projectId, project).catch(e => {
          console.log("[autorebuild] error:", e.message);
        });
      }
    }

    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: code === 0 ? "check" : "warn",
      text: "cloud-code beendet (exit " + code + ")" + (suggestionsApplied ? ` · ${suggestionsApplied} regel-vorschläge` : "") + (willRebuild ? " · APK-Rebuild läuft" : ""),
    }});
    applyMutation("ADD_SYNC_LOG", { entry: {
      source: "cloud", projectId,
      text: code === 0 ? "cc lieferte ergebnis" : `cc beendet mit fehler (${code})`,
    }});
    broadcastState();
    broadcastForProject({ type: "CC_STATUS", projectId, status: ccStatus(projectId), exitCode: code, output: fullOutput }, projectId);
    emitPush({ type: "cc_done", projectId, exitCode: code, suggestionsApplied });
  });

  proc.on("error", (err) => {
    // Timer + post-check lock unbedingt freigeben — sonst hängt
    // thinking-dot + autopump für diesen projektId für immer.
    if (job._thinkingTimer) { clearInterval(job._thinkingTimer); job._thinkingTimer = null; }
    ccJobs.delete(projectId);
    _ccPostChecks.delete(projectId);
    _ccPostCheckStartedAt.delete(projectId);
    cleanupResolvedConfig(mcpConfigPath);
    console.error("[cc] proc error:", err.message);
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn",
      text: "cloud-code fehler: " + escapeHtml(err.message),
    }});
    broadcastState();
    broadcastForProject({ type: "CC_STATUS", projectId, status: { state: "idle" }, error: err.message }, projectId);
    broadcastForProject({ type: "CC_THINKING_TEXT", projectId, text: "" }, projectId);
    emitPush({ type: "cc_error", projectId, error: err.message });
    _triggerAutoPumpNow();
  });

  return { ok: true, projectId, startedAt: job.startedAt };
}

// Task 3 · Pro stream-json-event: state-update + broadcast.
// Keine LLM-tokens — alles deterministisch aus dem cli-output abgeleitet.
function _handleCcStreamEvent(job, ev) {
  // FIX #2+#3: projectId direkt aus job-objekt — funktioniert auch wenn
  // ccJobs.delete bereits gelaufen ist (z.B. nach proc.close → flush()).
  // Vorher: O(jobs×projects)-iteration die nach delete leere result lieferte.
  const projectId = job.projectId;
  if (!projectId) return;
  if (ev.kind === "init") {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "info",
      text: `claude-session start · ${(ev.mcpServers || []).filter(m => m.status === "connected").map(m => m.name).join(", ") || "(keine MCPs)"}`,
    }});
    return;
  }
  if (ev.kind === "text") {
    job.assistantText += ev.text;
    // Stream nur clean-text (ohne protocol-blöcke) an UI
    const clean = ev.text
      .replace(/<<<(TASK_PLAN|TASK_STATUS|RULE_SUGGESTIONS|QUESTION)[\s\S]*?>>>/g, "");
    if (clean.trim()) {
      broadcastForProject({ type: "CC_OUTPUT", projectId, chunk: clean }, projectId);
    }
    // TASK_PLAN sobald komplett: subtasks anlegen (war im alten flow auch so).
    if (!job.planParsed && job.taskId) {
      const planM = job.assistantText.match(/<<<TASK_PLAN\s*([\s\S]*?)\s*>>>/);
      if (planM) {
        job.planParsed = true;
        try {
          const plan = JSON.parse(planM[1].trim());
          if (Array.isArray(plan.steps)) {
            const steps = plan.steps.map(s => String(s).replace(/^\s*\d+[.)]\s*/, "").trim())
              .filter(Boolean).slice(0, 8);
            steps.forEach(stepText => {
              applyMutation("ADD_SUBTASK", { projectId, taskId: job.taskId,
                subtask: { title: stepText, done: false } });
            });
            applyMutation("ADD_ACTIVITY", { projectId, event: {
              type: "info", text: `cc plan: ${steps.length} schritte`,
            }});
          }
        } catch (e) { /* swallow */ }
      }
    }
    return;
  }
  if (ev.kind === "tool_use") {
    // Live-tool-event: broadcast für UI + activity (für persistente history)
    job.toolEvents.push({
      id: ev.id, tool: ev.tool, glyph: ev.glyph,
      summary: ev.summary, ts: NOW(), state: "running",
    });
    if (job.toolEvents.length > 200) job.toolEvents.shift();
    broadcastForProject({
      type: "CC_TOOL_EVENT", projectId,
      phase: "use", id: ev.id, tool: ev.tool, glyph: ev.glyph, summary: ev.summary, ts: NOW(),
    }, projectId);
    // Activity-event nur für „interessante" tools (sonst log-spam):
    // Read/Glob/Grep sind read-only, machen 80% der events aus → nur „write" events ins log.
    if (["Edit", "Write", "MultiEdit", "Bash", "PowerShell"].includes(ev.tool)) {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: ev.tool === "Bash" || ev.tool === "PowerShell" ? "info" : "write",
        text: `${ev.glyph} <code>${escapeHtml(ev.tool)}</code> ${escapeHtml(ev.summary || "")}`.slice(0, 200),
      }});
    }
    return;
  }
  if (ev.kind === "tool_result") {
    const te = job.toolEvents.find(t => t.id === ev.id);
    if (te) { te.state = ev.isError ? "error" : "ok"; te.brief = ev.brief; }
    broadcastForProject({
      type: "CC_TOOL_EVENT", projectId,
      phase: "result", id: ev.id, tool: ev.tool, isError: ev.isError, brief: ev.brief, ts: NOW(),
    }, projectId);
    if (ev.isError) {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "warn",
        text: `⚠ ${escapeHtml(ev.tool)} fehler: ${escapeHtml((ev.brief || "").slice(0, 120))}`,
      }});
    }
    return;
  }
  if (ev.kind === "thinking") {
    // Optional sichtbar machen — kompakt
    broadcastForProject({
      type: "CC_THINKING_TEXT", projectId, text: ev.text.slice(0, 200),
    }, projectId);
    return;
  }
  if (ev.kind === "result") {
    job.realUsage = {
      tokensIn: ev.tokensIn || 0,
      tokensOut: ev.tokensOut || 0,
      cacheCreated: ev.cacheCreated || 0,
      cacheRead: ev.cacheRead || 0,
      costUsd: ev.costUsd,
      durationMs: ev.durationMs,
    };
    return;
  }
}

// Auto-pump pause sofort beenden — falls die rate-limit-detection fälschlich
// getriggert hat oder das echte limit vorbei ist + man nicht warten will.
app.post("/api/cc/resume-now", authMw, (req, res) => {
  const wasLimited = _ccApiLimitedUntil > NOW();
  _ccApiLimitedUntil = 0;
  console.log("[autopump] manual resume — limit-pause geleert (war aktiv:", wasLimited, ")");
  broadcastState();
  res.json({ ok: true, wasLimited });
});

app.post("/api/cc/stop", authMw, (req, res) => {
  const { projectId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  const job = ccJobs.get(projectId);
  if (!job) return res.status(404).json({ error: "kein job läuft" });
  // windows: SIGTERM an top-process verwaist sub-prozesse. killTreeGraceful
  // → taskkill /T /F (windows) bzw. SIGTERM → SIGKILL fallback (posix).
  killTreeGraceful(job.proc, { gracefulMs: 1500 });
  ccJobs.delete(projectId);
  applyMutation("ADD_ACTIVITY", { projectId, event: { type: "info", text: "cloud-code abgebrochen" }});
  broadcastState();
  broadcastForProject({ type: "CC_STATUS", projectId, status: { state: "idle" } }, projectId);
  res.json({ ok: true });
});

app.get("/api/cc/status", authMw, (req, res) => {
  // Pro session gefiltert: user sieht nur jobs auf projekten mit zugriff
  const out = {};
  for (const [pid, _] of ccJobs) {
    const proj = state.projects.find(p => p.id === pid);
    if (!proj) continue;
    if (req.session?.userId && memberships &&
        !memberships.hasRole(pid, req.session.userId, ROLES.VIEWER)) continue;
    out[pid] = ccStatus(pid);
  }
  res.json({ jobs: out });
});

// ─── Live-Preview ─────────────────────────────────────────
// Dev-server pro projekt starten (npm run dev / flutter run --web / etc.)
// und in der UI als iframe einbetten. Owner-only, in-memory job-map (kein
// persistierter zustand des prozesses — kill bei server-restart).
const previewJobs = new Map(); // projectId -> { proc, command, port, url, startedAt, logs }
const PREVIEW_LOG_LIMIT = 200;

function previewStatus(projectId) {
  const j = previewJobs.get(projectId);
  if (!j) return { state: "idle" };
  return {
    state: "running", command: j.command, port: j.port, url: j.url,
    startedAt: j.startedAt, pid: j.proc?.pid,
  };
}

// Auto-detect: aus package.json + pubspec.yaml ein vernünftiges command
// + port raten. Sucht auch in standard-subdirs (web/, frontend/, desktop-app/,
// mobile-app/, apps/*, packages/*), damit monorepos automatisch greifen.
// Keine LLM-tokens, pure heuristik.
function detectPreviewConfig(cwd) {
  const fs = require("node:fs");
  const path = require("node:path");
  const suggestions = [];
  // Suchpfade: root + erste-ebene-subdirs, die häufig dev-server enthalten.
  const candidates = [cwd];
  const commonSubs = ["web", "frontend", "client", "app", "apps", "packages", "desktop-app", "mobile-app", "ui", "site"];
  for (const sub of commonSubs) {
    const p = path.join(cwd, sub);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        candidates.push(p);
        // apps/* + packages/* eine ebene tiefer
        if (sub === "apps" || sub === "packages") {
          try {
            for (const child of fs.readdirSync(p).slice(0, 10)) {
              const cp = path.join(p, child);
              if (fs.statSync(cp).isDirectory()) candidates.push(cp);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  for (const dir of candidates) {
    const rel = path.relative(cwd, dir) || ".";
    try {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const scripts = pkg.scripts || {};
        let port = 3000;
        const allDeps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
        if (allDeps.vite || allDeps["@vitejs/plugin-react"] || allDeps["@vitejs/plugin-vue"]) port = 5173;
        else if (allDeps.next) port = 3000;
        else if (allDeps.astro) port = 4321;
        else if (allDeps["@sveltejs/kit"]) port = 5173;
        else if (allDeps.nuxt || allDeps.nuxt3) port = 3000;
        // cd <dir> nur wenn nicht root — cmd.exe-kompatibel via "&&" wäre
        // shell-injection. Stattdessen brauchen wir keinen cd da das spawn
        // schon cwd setzt — aber preview spawnt im project.path. workaround:
        // wir suggest-en command + zusätzliches workdir-feld? simpler:
        // wir geben den relativen pfad als HINWEIS im label, command bleibt
        // npm run dev. spawn nutzt project.path als cwd — also funktioniert
        // nur wenn package.json im root liegt. für monorepos: wir lassen
        // user via 'cwd-tipp' wissen, aber stripen cd aus dem command.
        // Bessere lösung: command-prefix mit shell-safe cwd-switch via
        // 'pushd <dir> && command' — aber das fällt unter shell-injection-
        // sperre. → wir packen statt dessen 'npm --prefix <dir> run dev'.
        if (scripts.dev) suggestions.push({
          command: "npm run dev", port,
          cwdRel: rel === "." ? "" : rel,
          label: rel !== "." ? `${rel} · npm run dev` : "npm run dev",
        });
        if (scripts.start && !scripts.dev) suggestions.push({
          command: "npm start", port,
          cwdRel: rel === "." ? "" : rel,
          label: rel !== "." ? `${rel} · npm start` : "npm start",
        });
      }
    } catch (_) {}
    try {
      const pubPath = path.join(dir, "pubspec.yaml");
      if (fs.existsSync(pubPath)) {
        suggestions.push({
          command: "flutter run -d chrome --web-port=8090",
          port: 8090,
          cwdRel: rel === "." ? "" : rel,
          label: rel !== "." ? `${rel} · flutter run -d chrome` : "flutter run -d chrome",
        });
      }
    } catch (_) {}
    // Python web
    try {
      if (fs.existsSync(path.join(dir, "manage.py"))) {
        suggestions.push({
          command: "python manage.py runserver 0.0.0.0:8000", port: 8000,
          cwdRel: rel === "." ? "" : rel,
          label: rel !== "." ? `${rel} · django runserver` : "django runserver",
        });
      } else if (fs.existsSync(path.join(dir, "app.py")) || fs.existsSync(path.join(dir, "wsgi.py"))) {
        suggestions.push({
          command: "python -m flask run --host=0.0.0.0 --port=5000", port: 5000,
          cwdRel: rel === "." ? "" : rel,
          label: rel !== "." ? `${rel} · flask run` : "flask run",
        });
      }
    } catch (_) {}
    // Statisches HTML (index.html ohne package.json) → http-server
    try {
      if (fs.existsSync(path.join(dir, "index.html")) &&
          !fs.existsSync(path.join(dir, "package.json")) &&
          !fs.existsSync(path.join(dir, "pubspec.yaml"))) {
        suggestions.push({
          command: "npx --yes serve -l 4173 .", port: 4173,
          cwdRel: rel === "." ? "" : rel,
          label: rel !== "." ? `${rel} · statisches HTML` : "statisches HTML",
        });
      }
    } catch (_) {}
  }

  return suggestions;
}

app.get("/api/preview/detect", authMw, (req, res) => {
  const projectId = String(req.query.projectId || "");
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  if (!project.path) return res.json({ suggestions: [] });
  try { assertSafeProjectPath(project.path, "preview.detect.cwd"); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  res.json({ suggestions: detectPreviewConfig(project.path) });
});

app.post("/api/preview/start", authMw, (req, res) => {
  const { projectId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  // Owner-only — preview spawnt arbitrary shell commands, das ist kein
  // viewer/member-job. (Same trust model wie cc-runs.)
  if (!_requireProjectAccess(req, res, project, ROLES.OWNER)) return;
  if (!project.path) return res.status(400).json({ error: "projekt hat keinen pfad gesetzt" });
  try { assertSafeProjectPath(project.path, "preview.start.cwd"); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  if (previewJobs.has(projectId)) return res.status(409).json({ error: "preview läuft schon" });

  const cfg = project.preview || {};
  const command = (cfg.command || "").trim();
  if (!command) return res.status(400).json({ error: "kein command konfiguriert" });
  // Sicherheit: ein paar offensichtliche shell-injektions-vektoren blocken.
  // Owner-trust ist da, aber wir wollen nicht via getätigtes-preview-feld
  // die ganze platte löschen wenn jemand das config-feld als attack-vector
  // benutzt (z.B. via leaked OWNER-session).
  if (/[;&|`$\n\r]/.test(command)) {
    return res.status(400).json({ error: "command enthält unzulässige zeichen (; & | ` $ newline)" });
  }
  const port = Number.isFinite(cfg.port) ? cfg.port : null;
  const url = cfg.url || (port ? `http://localhost:${port}` : "");

  // PATH-Augmentation: viele projekte bundlen ihr SDK lokal (Flutter/,
  // flutter/, .fvm/, node_modules/.bin). Wenn wir diese ordner in PATH
  // prepend-en, funktioniert "flutter run", "next dev" etc. ohne dass der
  // user den SDK global installieren muss.
  const augmentedPath = (() => {
    const fs = require("node:fs");
    const path = require("node:path");
    const sep = process.platform === "win32" ? ";" : ":";
    const candidates = [
      path.join(project.path, "Flutter", "flutter", "bin"),
      path.join(project.path, "Flutter", "bin"),
      path.join(project.path, "flutter", "bin"),
      path.join(project.path, ".fvm", "flutter_sdk", "bin"),
      path.join(project.path, "node_modules", ".bin"),
    ];
    const prefix = candidates.filter(p => {
      try { return fs.existsSync(p); } catch (_) { return false; }
    });
    if (prefix.length === 0) return process.env.PATH;
    return prefix.join(sep) + sep + (process.env.PATH || "");
  })();

  // cwd: bei monorepo-detection liegt das command in einem sub-ordner. wir
  // hängen den ans project.path und prüfen mit assertSafeProjectPath dass
  // niemand via cwdRel rausbricht.
  const path = require("node:path");
  const fs = require("node:fs");
  const spawnCwd = cfg.cwdRel
    ? path.resolve(project.path, cfg.cwdRel)
    : project.path;
  try { assertSafeProjectPath(spawnCwd, "preview.start.spawnCwd"); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  if (!fs.existsSync(spawnCwd)) {
    return res.status(400).json({ error: "preview-cwd existiert nicht: " + spawnCwd });
  }
  // resolve ist relativ zu root sicher, aber zusätzlich: cwdRel darf nicht
  // aus project.path raushebeln (via symlinks / ..).
  if (!spawnCwd.toLowerCase().startsWith(path.resolve(project.path).toLowerCase())) {
    return res.status(400).json({ error: "preview-cwd liegt außerhalb des projects" });
  }

  const { spawn, spawnSync } = require("node:child_process");
  const spawnEnv = {
    ...process.env,
    PATH: augmentedPath,
    Path: augmentedPath, // windows-case
    BROWSER: "none", // verhindert dass dev-server eigenes browser-tab öffnet
  };

  // Auto-bootstrap: flutter run -d chrome braucht ein web/ unterverzeichnis.
  // Wenn das fehlt, läuft `flutter create . --platforms=web` einmalig durch,
  // damit der user nicht "flutter create" manuell tippen muss. blockierend
  // (~5-15s), aber nur beim allerersten start.
  if (/^flutter\s+run\b/.test(command) && !fs.existsSync(path.join(spawnCwd, "web"))) {
    console.log("[preview] flutter web-support fehlt, bootstrappe via 'flutter create .'");
    try {
      const r = spawnSync("flutter", ["create", ".", "--platforms=web"], {
        cwd: spawnCwd, shell: true, windowsHide: true,
        env: spawnEnv, timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
      });
      if (r.status !== 0) {
        const errOut = (r.stderr?.toString() || r.stdout?.toString() || "").slice(0, 500);
        return res.status(500).json({ error: "flutter create fehlgeschlagen: " + errOut });
      }
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "info", text: "preview: flutter web-support automatisch eingerichtet (flutter create .)",
      }});
    } catch (e) {
      return res.status(500).json({ error: "flutter-bootstrap fehler: " + e.message });
    }
  }

  let proc;
  try {
    proc = spawn(command, [], {
      cwd: spawnCwd,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv,
    });
  } catch (e) {
    return res.status(500).json({ error: "spawn fehlgeschlagen: " + e.message });
  }

  const job = {
    proc, command, port, url, startedAt: NOW(),
    logs: [], // ring-buffer
  };
  previewJobs.set(projectId, job);

  const pushLog = (stream, chunk) => {
    const text = chunk.toString();
    job.logs.push({ ts: NOW(), stream, text });
    if (job.logs.length > PREVIEW_LOG_LIMIT) job.logs.splice(0, job.logs.length - PREVIEW_LOG_LIMIT);
    broadcastForProject({
      type: "PREVIEW_OUTPUT", projectId, chunk: text, stream,
    }, projectId);
  };
  proc.stdout.on("data", c => pushLog("stdout", c));
  proc.stderr.on("data", c => pushLog("stderr", c));
  proc.on("error", (err) => {
    console.error("[preview] proc error:", err.message);
    previewJobs.delete(projectId);
    broadcastForProject({ type: "PREVIEW_STATUS", projectId, status: { state: "idle", error: err.message } }, projectId);
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn", text: "preview-server fehler: " + escapeHtml(err.message),
    }});
    broadcastState();
  });
  proc.on("close", (code) => {
    previewJobs.delete(projectId);
    console.log("[preview] done", projectId, "exit", code);
    broadcastForProject({ type: "PREVIEW_STATUS", projectId, status: { state: "idle", exitCode: code } }, projectId);
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "info", text: "preview-server beendet (exit " + code + ")",
    }});
    broadcastState();
  });

  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: "info", text: "preview-server gestartet · <code>" + escapeHtml(command) + "</code>",
  }});
  broadcastState();
  broadcastForProject({ type: "PREVIEW_STATUS", projectId, status: previewStatus(projectId) }, projectId);
  res.json({ ok: true, status: previewStatus(projectId) });
});

app.post("/api/preview/stop", authMw, (req, res) => {
  const { projectId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.OWNER)) return;
  const job = previewJobs.get(projectId);
  if (!job) return res.status(404).json({ error: "kein preview läuft" });
  // dev-server-prozesse (vite/next/flutter) spawnen sub-prozesse — auf
  // windows tötet child.kill() nur cmd.exe-wrapper, kinder bleiben. tree-kill.
  killTreeGraceful(job.proc, { gracefulMs: 1500 });
  previewJobs.delete(projectId);
  res.json({ ok: true });
});

app.get("/api/preview/status", authMw, (req, res) => {
  const projectId = String(req.query.projectId || "");
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.VIEWER)) return;
  const job = previewJobs.get(projectId);
  res.json({
    status: previewStatus(projectId),
    logs: job ? job.logs.slice(-50) : [],
  });
});

// Vorschläge generieren: claude analysiert Projekt + schlägt 5-10 Improvements vor
app.post("/api/cc/suggest", authMw, async (req, res) => {
  const { projectId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  runSuggestionAnalysis(project).catch(e => console.log("[suggest] error:", e.message));
  res.json({ ok: true });
});

// Task 6 · Task-Dekomposition: cc zerlegt einen großen task vorab in 3-8
// subtasks. User-getriggert (button-klick), nicht auto. Cap budget 0.20$.
app.post("/api/cc/decompose", authMw, async (req, res) => {
  const { projectId, taskId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  const task = (project.tasks || []).find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: "task nicht gefunden" });
  res.json({ ok: true });
  runTaskDecompose(project, task).catch(e => console.log("[decompose] error:", e.message));
});

// Goal-Based Planning: nimmt project.goals → cc generiert milestones + tasks.
// Async (fire-and-forget); UI sieht tasks erscheinen via state-broadcast.
app.post("/api/projects/:id/plan-from-goals", authMw, async (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  res.json({ ok: true, goalsCount: (project.goals || []).length });
  runAutoPlanFromGoals(project).catch(e => console.log("[auto-plan] error:", e.message));
});

// CC-Metrics: aggregierte stats über die letzten N jobs (token-/cost-/zeit-
// durchschnitte, model-routing-hit-rate). Read-only — UI kann sie nutzen
// für "live self-optimization"-dashboard. Master-spec item 1, ohne
// automatische rule-mutation (das wäre risikoreich + braucht user-approval).
app.get("/api/cc/metrics", authMw, (req, res) => {
  const jobs = (state.ccBudget && state.ccBudget.jobs) || [];
  if (jobs.length === 0) {
    return res.json({
      total: 0, last24h: 0,
      avgDurationMs: 0, avgInputTokens: 0, avgOutputTokens: 0, avgCostUsd: 0,
      modelMix: {}, successRate: 0,
      slowestJobs: [], expensiveJobs: [],
    });
  }
  const now = NOW();
  const last24h = jobs.filter(j => now - j.ts < 24 * 60 * 60 * 1000);
  const recent = last24h.length > 0 ? last24h : jobs;
  const sum = (arr, f) => arr.reduce((a, j) => a + (f(j) || 0), 0);
  const avg = (arr, f) => arr.length ? sum(arr, f) / arr.length : 0;
  const modelMix = {};
  for (const j of recent) {
    const m = j.model || "unknown";
    modelMix[m] = (modelMix[m] || 0) + 1;
  }
  const successRate = recent.length ? recent.filter(j => j.ok).length / recent.length : 0;
  const slowest = [...recent].sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 5);
  const expensive = [...recent].sort((a, b) => (b.costUsd || 0) - (a.costUsd || 0)).slice(0, 5);
  res.json({
    total: jobs.length,
    last24h: last24h.length,
    avgDurationMs: Math.round(avg(recent, j => j.durationMs)),
    avgInputTokens: Math.round(avg(recent, j => j.inputTokens)),
    avgOutputTokens: Math.round(avg(recent, j => j.outputTokens)),
    avgCostUsd: avg(recent, j => j.costUsd),
    modelMix,
    successRate,
    slowestJobs: slowest.map(j => ({
      taskId: j.taskId, ts: j.ts, durationMs: j.durationMs,
      model: j.model, ok: j.ok,
    })),
    expensiveJobs: expensive.map(j => ({
      taskId: j.taskId, ts: j.ts, costUsd: j.costUsd,
      model: j.model, outputTokens: j.outputTokens,
    })),
  });
});

// M2 · Cleanup: existing cc-vorgeschlagene regeln + pending rule_diffs,
// die nach dem strengeren classifier eigentlich Ideen sind, rückwirkend
// umrouten. 0 LLM-tokens — reine classifier-anwendung.
//
// Drei stufen:
//   1) inactive cc-rules → ideas (waren nie vom user approved)
//   2) pending rule_diffs für ideen-artige rules → rejected + idea
//   3) optional `aggressive`: auch active cc-rules → ideas (war approve war
//      irrtum; user bestätigt via dialog vorher)
app.post("/api/projects/:id/rules/cleanup", authMw, (req, res) => {
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.OWNER)) return;
  const aggressive = !!(req.body && req.body.aggressive);
  const before = (project.rules || []).length;
  const beforeDiffs = ((project.ruleDiffs || []).filter(d => d.status === "pending")).length;

  const movedToIdea = [];
  const kept = [];
  for (const r of (project.rules || [])) {
    const kind = classifyRuleOrIdea(r.text || "");
    const isCc = r.suggestedBy === "cloud-code";
    const move = kind === "idea" && isCc && (r.active === false || aggressive);
    if (move) movedToIdea.push(r);
    else kept.push(r);
  }

  // Pending rule_diffs: bei ideen-artigen referenz-rules → reject + zu idea
  const diffsKept = [];
  let rejectedDiffs = 0;
  for (const d of (project.ruleDiffs || [])) {
    if (d.status !== "pending") { diffsKept.push(d); continue; }
    const kind = classifyRuleOrIdea(d.text || "");
    if (kind === "idea") {
      diffsKept.push({ ...d, status: "rejected" });
      // Auch zu idea machen
      movedToIdea.push({ text: d.text, suggestedBy: "cloud-code" });
      rejectedDiffs++;
    } else {
      diffsKept.push(d);
    }
  }

  // FIX #10: bei aggressive auch active-rules zu removedRules (tombstone)
  // pushen, damit rückgängig möglich + audit-trail in state existiert.
  // Default (active=false only) ist sowieso harmlos da diese rules nie
  // vom user genehmigt wurden.
  let removedRulesTomb = project.removedRules ? [...project.removedRules] : [];
  if (aggressive) {
    const cleanupTs = NOW();
    for (const r of movedToIdea) {
      // Nur active-rules ins tombstone (sind die wo data-loss-risiko da ist)
      const wasActive = (project.rules || []).some(x => x.id === r.id && x.active === true);
      if (wasActive && r.text) {
        removedRulesTomb.unshift({
          text: r.text, ts: cleanupTs,
          reason: "cleanup-aggressive",
          category: r.category || null,
        });
      }
    }
    removedRulesTomb = removedRulesTomb.slice(0, 50);
  }

  // State mutieren: ideen anhängen (dedup), rules ersetzen, rule_diffs ersetzen
  const ideaTexts = new Set((project.ideas || []).map(i => (i.text || "").trim().toLowerCase()));
  let addedIdeas = 0;
  for (const r of movedToIdea) {
    const txt = (r.text || "").trim();
    if (!txt || ideaTexts.has(txt.toLowerCase())) continue;
    ideaTexts.add(txt.toLowerCase());
    applyMutation("ADD_IDEA", { projectId: project.id, idea: {
      text: txt, status: "unprocessed", source: "cloud-code", createdAt: NOW(),
    }});
    addedIdeas++;
  }
  applyMutation("PATCH_PROJECT", { projectId: project.id,
    patch: { rules: kept, ruleDiffs: diffsKept, removedRules: removedRulesTomb } });
  applyMutation("ADD_ACTIVITY", { projectId: project.id, event: {
    type: "rule",
    text: `regel-cleanup${aggressive ? " (aggressive)" : ""}: ${movedToIdea.length - rejectedDiffs} task-artige cc-regeln + ${rejectedDiffs} pending-diffs → ideen (${addedIdeas} neu)`,
  }});
  applyMutation("ADD_SYNC_LOG", { entry: {
    source: "system", projectId: project.id,
    text: `regel-cleanup ausgeführt · rules ${before}→${kept.length} · ${addedIdeas} ideen erzeugt${aggressive ? " (aggressive, rückgängig via removedRules)" : ""}`,
  }});
  broadcastState();
  res.json({
    ok: true, projectId: project.id, aggressive,
    rulesBefore: before, rulesAfter: kept.length,
    diffsBefore: beforeDiffs, diffsRejected: rejectedDiffs,
    movedToIdea: movedToIdea.length, addedAsNewIdea: addedIdeas,
    // Genaue texte zurückgeben — UI kann „rückgängig" anzeigen
    movedTexts: movedToIdea.map(r => r.text).slice(0, 50),
  });
});

// AI-Summarize: kürzt eine lange beschreibung auf max ~120 chars (eine zeile).
// Idee: lange description bleibt im project (descriptionLong), kurze landet
// im header — verhindert dass der text die buttons aus dem viewport drückt.
app.post("/api/cc/summarize", authMw, async (req, res) => {
  if (!claudeCliInfo.installed) {
    return res.status(503).json({ error: "claude-cli nicht installiert (settings → auto-install)" });
  }
  const { projectId, text, maxChars } = req.body || {};
  let project = null;
  let raw = String(text || "").trim();
  if (projectId) {
    project = state.projects.find(p => p.id === projectId);
    if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
    if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
    if (!raw) raw = String(project.descriptionLong || project.description || "").trim();
  }
  if (!raw) return res.status(400).json({ error: "text fehlt" });
  if (raw.length > 20000) return res.status(400).json({ error: "text zu lang (>20k)" });
  const cap = Math.max(60, Math.min(200, Number(maxChars) || 120));
  const prompt = [
    `Kürze den folgenden text auf MAX ${cap} zeichen (eine zeile).`,
    "- Behalte die essenz (was, für wen, warum)",
    "- Keine markdown-syntax (kein **, kein #, keine listen)",
    "- Deutsch",
    "- Nur den kurzen text antworten, KEINE erklärung, KEINE quotes drumherum.",
    "",
    "TEXT:",
    raw,
  ].join("\n");
  try {
    const out = await _spawnClaudeOneShot(prompt);
    let summary = String(out || "").trim();
    // claude hängt manchmal text drumherum — nimm die erste sinnvolle zeile
    summary = summary.replace(/^["'`]+|["'`]+$/g, "").split(/\r?\n/)[0].trim();
    if (!summary) return res.status(502).json({ error: "leere antwort von claude" });
    if (summary.length > cap + 40) summary = summary.slice(0, cap).trim() + "…";
    res.json({ summary, originalLength: raw.length });
  } catch (e) {
    res.status(500).json({ error: "summarize fehlgeschlagen: " + (e && e.message) });
  }
});

// ─── AI-Scaffold (neues projekt designen mit claude) ──────────
// Zwei modi:
//  · mode=improve    → claude verbessert/expandiert die rohbeschreibung
//  · mode=scaffold   → claude generiert goals/rules/tasks/files aus
//                       (verbessertem) beschreibungs-text.
// Kein projekt-bezug, läuft als ein-shot read-only claude-call.
function _spawnClaudeOneShot(prompt) {
  const cwd = process.cwd();
  const claudeBin = resolveClaudeBinary();
  const args = [
    "--print",
    "--permission-mode", "bypassPermissions",
    "--dangerously-skip-permissions",
    "--max-budget-usd", "0.5",
  ];
  return new Promise((resolve) => {
    let out = "";
    const proc = spawn(claudeBin, args, {
      cwd, shell: true, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...userSettings.envOverlay() },
    });
    proc.stdout.on("data", (c) => { out += c.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("error", () => resolve(""));
    proc.on("close", () => resolve(out));
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

app.post("/api/cc/scaffold", authMw, async (req, res) => {
  if (!claudeCliInfo.installed) {
    return res.status(503).json({ error: "claude-cli nicht installiert (settings → auto-install)" });
  }
  const { mode, description, name } = req.body || {};
  const text = String(description || "").trim();
  if (!text) return res.status(400).json({ error: "description fehlt" });
  if (text.length > 10000) return res.status(400).json({ error: "description zu lang (>10k)" });

  if (mode === "improve") {
    const prompt = [
      "Du bekommst eine rohe projekt-idee. Verbessere + expandiere sie zu",
      "einer detaillierten beschreibung (5-15 sätze) für ein software-projekt.",
      "Nenne kern-features konkret. Tech-stack erwähnen wenn der user keinen genannt hat.",
      "Bleib bei dem was der user wollte — füge nichts erfundenes hinzu, nur klarstellen + strukturieren.",
      "Antwort NUR mit dem JSON-block, KEIN markdown-fencing:",
      "<<<IMPROVED",
      '{"description":"…","techStack":"flutter|node|web|other","techNotes":"…"}',
      ">>>",
      "",
      "ROHE IDEE:",
      text,
    ].join("\n");
    const out = await _spawnClaudeOneShot(prompt);
    const m = out.match(/<<<IMPROVED\s*([\s\S]*?)\s*>>>/);
    if (!m) return res.status(500).json({ error: "claude antwort nicht parsebar", raw: out.slice(0, 500) });
    try {
      const data = JSON.parse(m[1].trim());
      return res.json({
        description: String(data.description || "").trim(),
        techStack: String(data.techStack || "other").trim(),
        techNotes: String(data.techNotes || "").trim(),
      });
    } catch (e) {
      return res.status(500).json({ error: "JSON-parse fail: " + e.message, raw: m[1].slice(0, 500) });
    }
  }

  if (mode === "scaffold") {
    const prompt = [
      "Du bekommst eine projekt-beschreibung. Generiere einen vollständigen scaffold-plan:",
      "- 5-10 PROJEKTZIELE (jeweils 1 satz, klar messbar)",
      "- 10-15 REGELN (code-stil/architektur/workflow, jeweils 1 satz)",
      "- 15-25 ERSTE TASKS in phasen: setup → core-features → polish → launch",
      "  Jeder task: title (max 80 zeichen), priority (1-5), group (in_progress|next), meta-tag.",
      "- DATEISTRUKTUR (10-20 einträge mit depth-level 0-3)",
      "",
      "Wenn der user einen tech-stack genannt hat (flutter/node/web/...), nimm tools/best-practices davon.",
      "Tasks: setup-tasks bekommen prio 5, core 4, polish 3, launch 5. Erste 3 in_progress, rest next.",
      "",
      "Antwort NUR mit dem JSON-block, KEIN markdown-fencing:",
      "<<<SCAFFOLD",
      "{",
      '  "goals": ["…", "…"],',
      '  "rules": [{"category":"code-stil|architektur|workflow","text":"…"}],',
      '  "tasks": [{"title":"…","priority":5,"group":"in_progress","meta":"setup"}],',
      '  "files": [{"name":"…","depth":0}]',
      "}",
      ">>>",
      "",
      "PROJEKTNAME: " + String(name || "").slice(0, 100),
      "BESCHREIBUNG:",
      text,
    ].join("\n");
    const out = await _spawnClaudeOneShot(prompt);
    const m = out.match(/<<<SCAFFOLD\s*([\s\S]*?)\s*>>>/);
    if (!m) return res.status(500).json({ error: "claude antwort nicht parsebar", raw: out.slice(0, 500) });
    try {
      const data = JSON.parse(m[1].trim());
      return res.json({
        goals: Array.isArray(data.goals) ? data.goals.filter((g) => typeof g === "string").slice(0, 12) : [],
        rules: Array.isArray(data.rules)
          ? data.rules.filter((r) => r && typeof r.text === "string").slice(0, 20).map((r) => ({
              category: ["code-stil","architektur","workflow"].includes(r.category) ? r.category : "workflow",
              text: String(r.text).slice(0, 200),
            }))
          : [],
        tasks: Array.isArray(data.tasks)
          ? data.tasks.filter((t) => t && typeof t.title === "string").slice(0, 30).map((t) => ({
              title: String(t.title).slice(0, 120),
              priority: Math.max(1, Math.min(5, Number(t.priority) || 3)),
              group: ["in_progress", "next"].includes(t.group) ? t.group : "next",
              meta: String(t.meta || "").slice(0, 50),
            }))
          : [],
        files: Array.isArray(data.files)
          ? data.files.filter((f) => f && typeof f.name === "string").slice(0, 30).map((f) => ({
              name: String(f.name).slice(0, 100),
              depth: Math.max(0, Math.min(5, Number(f.depth) || 0)),
            }))
          : [],
      });
    } catch (e) {
      return res.status(500).json({ error: "JSON-parse fail: " + e.message, raw: m[1].slice(0, 500) });
    }
  }

  return res.status(400).json({ error: "mode muss 'improve' oder 'scaffold' sein" });
});

// Bug-Hunt starten: claude scannt nach Bugs
app.post("/api/cc/bughunt", authMw, async (req, res) => {
  const { projectId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  runBugHunt(project).catch(e => console.log("[bughunt] error:", e.message));
  res.json({ ok: true });
});

// publicState: pair-sessions sehen alles (legacy); user-sessions nur projekte,
// in denen sie member sind. `session` undefined = full state (z.b. internes
// logging, autopump). Verwendet pure-helper aus lib/project_access.
// Cache für path-existenz-checks: fs.existsSync auf jedem broadcast wäre
// teuer (lots of syscalls). 10s TTL ist genug — pfad-änderungen sind selten.
const _pathValidCache = new Map(); // projectId -> { valid, checkedAt }
function projectPathValid(project) {
  if (!project || !project.path) return false;
  const cached = _pathValidCache.get(project.id);
  const now = NOW();
  if (cached && now - cached.checkedAt < 10_000) return cached.valid;
  let valid = false;
  try { valid = fs.existsSync(project.path); } catch (_) { valid = false; }
  _pathValidCache.set(project.id, { valid, checkedAt: now });
  return valid;
}

// Boot-ts: bei jedem server-start neu. Clients merken sich den ts und
// vergleichen mit dem neuen. Wenn neuer (= server wurde neu gestartet,
// vermutlich via update.bat), zeigen wir banner "neue version — F5".
// Keine force-reload, damit user-drafts (chat-eingabe, task-titel im
// editor) erhalten bleiben.
const SERVER_BOOT_TS = NOW();

function publicState(session) {
  const base = (!session || !memberships)
    ? state
    : filterStateForSession(state, session, memberships);
  // Annotate jedes projekt mit pathValid — desktop+mobile UI können warnen
  // wenn der pfad fehlt oder auf diesem rechner nicht existiert (cross-network
  // collab-szenario).
  return {
    ...base,
    projects: (base.projects || []).map(p => ({
      ...p,
      pathValid: projectPathValid(p),
      // Live-preview-runtime-status (in-memory, nicht persistiert)
      previewState: previewStatus(p.id),
      // cc-runtime: welche task gerade von cc bearbeitet wird (in-memory).
      // UI zeigt diese task als „🔄 cc bearbeitet" + group-override „in arbeit".
      currentCcTaskId: ccJobs.get(p.id)?.taskId || null,
      currentCcStartedAt: ccJobs.get(p.id)?.startedAt || null,
    })),
    // Transient: auto-pump-pause-flag. Wenn _ccApiLimitedUntil in der zukunft
    // liegt, war kurz vorher ein API-limit. UI zeigt warnung + resume-button.
    ccApiLimitedUntil: _ccApiLimitedUntil > NOW() ? _ccApiLimitedUntil : 0,
    serverBootTs: SERVER_BOOT_TS,
  };
}

// ─── Vorschläge + Bug-Hunt (claude-Analyse-Pässe) ──────────
function _spawnClaudeReadOnly(project, prompt, opts) {
  // Bug-fix: kein silent fallback auf process.cwd() (sync-server/) — sonst
  // analysiert cc den server statt das echte projekt. Wenn pfad fehlt:
  // leer zurück (caller behandelt "" als no-result), kein fake-run.
  if (!project.path || !fs.existsSync(project.path)) {
    console.log("[cc-readonly] skip: project.path fehlt/invalid für " + project.name + " (" + JSON.stringify(project.path) + ")");
    return Promise.resolve("");
  }
  const cwd = project.path;
  const claudeBin = resolveClaudeBinary();
  const mcpConfigPath = resolveMcpConfig({ baseDir: __dirname });
  // Token-spar: caller darf budget runtersetzen (z.B. decompose nur 0.20$).
  const budget = (opts && typeof opts.maxBudgetUsd === "number") ? String(opts.maxBudgetUsd) : "1.0";
  const args = [
    "--print",
    "--permission-mode", "bypassPermissions",
    "--dangerously-skip-permissions",
    "--tools", "default",
    "--add-dir", cwd,
    "--max-budget-usd", budget,
  ];
  if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);

  return new Promise((resolve) => {
    let out = "";
    // Defense-in-depth: cwd kann aus persistierter state.json stammen.
    try { assertSafeProjectPath(cwd, "readonly.cwd"); }
    catch (e) { console.log("[cc-readonly] unsicherer cwd, abort:", e.message); return resolve(""); }
    const proc = spawn(claudeBin, args, {
      cwd, shell: true, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...userSettings.envOverlay() },
    });
    proc.stdout.on("data", c => { out += c.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("error", () => { cleanupResolvedConfig(mcpConfigPath); resolve(""); });
    proc.on("close", () => { cleanupResolvedConfig(mcpConfigPath); resolve(out); });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// Task 6 · Dekomposition: ein epic-task → 3-8 subtasks vorab anlegen.
// Token-spar-design: ein einziger readonly-call, kurzer prompt, output cap.
// User-getriggert (decompose-button), läuft nicht automatisch.
async function runTaskDecompose(project, task) {
  const projectId = project.id;
  if ((task.subtasks || []).length >= 3) {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "info", text: `dekompose übersprungen — task hat schon ${task.subtasks.length} subtasks`,
    }});
    broadcastState();
    return;
  }
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: "info", text: `dekompose startet: <i>${escapeHtml(task.title)}</i>`,
  }});
  broadcastState();

  const activeRules = (project.rules || []).filter(r => r.active).slice(0, 8).map(r => "- " + r.text);
  const prompt = [
    "Zerlege diese aufgabe in 3-8 konkrete, umsetzbare unterschritte.",
    "Projekt: " + project.name + " (" + project.tech + ").",
    "Aktive regeln (auswahl):\n" + activeRules.join("\n"),
    "",
    "AUFGABE: " + task.title + (task.meta ? "\nMeta: " + task.meta : ""),
    "",
    "Antworte NUR mit dem JSON-block (keine erklärung davor/danach):",
    "<<<SUBTASKS",
    '["1. Konkreter schritt", "2. Nächster schritt", "..."]',
    ">>>",
  ].join("\n");

  const out = await _spawnClaudeReadOnly(project, prompt, { maxBudgetUsd: 0.2 });
  const m = out.match(/<<<SUBTASKS\s*([\s\S]*?)\s*>>>/);
  let count = 0;
  if (m) {
    try {
      const list = JSON.parse(m[1].trim());
      if (Array.isArray(list)) {
        for (const raw of list.slice(0, 8)) {
          const clean = String(raw).replace(/^\s*\d+[.)]\s*/, "").trim();
          if (!clean) continue;
          applyMutation("ADD_SUBTASK", { projectId, taskId: task.id,
            subtask: { title: clean.slice(0, 200), done: false } });
          count++;
        }
      }
    } catch (e) { console.log("[decompose] parse fail:", e.message); }
  }
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: count > 0 ? "check" : "warn",
    text: `dekompose fertig · ${count} subtasks erzeugt`,
  }});
  broadcastState();
}

async function runSuggestionAnalysis(project) {
  const projectId = project.id;
  applyMutation("ADD_ACTIVITY", { projectId, event: { type: "info", text: "vorschläge-analyse gestartet…" }});
  broadcastState();

  const prompt = [
    "Analysiere das Projekt: " + project.name + " (" + project.tech + ").",
    "",
    "PROJEKTZIELE:\n" + (project.goals || []).map(g => "- " + g).join("\n"),
    "",
    "Lies grob die Struktur (mobile-app/, desktop-app/, sync-server/) und überlege:",
    "Welche 5-10 sinnvollen Verbesserungen könnten der App helfen?",
    "Kategorien: 'feature', 'ux', 'performance', 'code-quality', 'security'.",
    `Sei konkret + umsetzbar (kein „mehr tests"). Bevorzuge echte UX-Verbesserungen.`,
    "",
    "Antworte nur mit JSON-Block, keine Markdown-Fencing:",
    "<<<SUGGESTIONS",
    '[{"category":"ux","title":"...","reason":"warum hilft das","effort":"low|medium|high"}, ...]',
    ">>>",
  ].join("\n");

  const out = await _spawnClaudeReadOnly(project, prompt);
  const m = out.match(/<<<SUGGESTIONS\s*([\s\S]*?)\s*>>>/);
  let count = 0;
  if (m) {
    try {
      const list = JSON.parse(m[1].trim());
      if (Array.isArray(list)) {
        for (const s of list.slice(0, 10)) {
          if (!s || !s.title) continue;
          applyMutation("ADD_SUGGESTION", { projectId, suggestion: {
            category: String(s.category || "feature"),
            title: String(s.title).slice(0, 200),
            reason: String(s.reason || "").slice(0, 400),
            effort: ["low","medium","high"].includes(s.effort) ? s.effort : "medium",
            source: "cloud-code",
          }});
          count++;
        }
      }
    } catch (e) {}
  }
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: "edit",
    text: `vorschläge-analyse fertig · ${count} vorschläge`,
  }});
  broadcastState();
}

// Goal-based planning: nimmt project.goals → fragt cc nach einer roadmap
// (3-5 milestones × je 3-5 tasks). Tasks landen als group="next" mit
// "milestone:<name>" im meta-feld. Spart dem user manuelles task-brainstorm.
//
// (master-spec item: "Goal-Based Planning · idea → roadmap → milestones →
// tasks vollautomatisch")
async function runAutoPlanFromGoals(project) {
  const projectId = project.id;
  if (!project.goals || project.goals.length === 0) {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn",
      text: "auto-plan abgebrochen: keine projektziele gesetzt — bitte erst ziele in den projekt-einstellungen pflegen",
    }});
    broadcastState();
    return { ok: false, error: "keine ziele" };
  }
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: "info", text: `auto-plan gestartet (${project.goals.length} ziele) …`,
  }});
  broadcastState();

  const existingTitles = new Set((project.tasks || []).map(t => (t.title || "").toLowerCase().trim()));

  const prompt = [
    "PROJEKT-ROADMAP-PLANUNG für: " + project.name + " (" + project.tech + ").",
    "",
    "PROJEKTZIELE:",
    ...project.goals.map((g, i) => `${i+1}. ${g}`),
    "",
    "Zerlege diese ziele in eine umsetzbare roadmap mit 3-5 milestones,",
    "jedes milestone mit 3-5 konkreten tasks (max 15 tasks gesamt).",
    "",
    "Regeln:",
    "- tasks sind konkret + umsetzbar in 1-4 stunden (kein 'projekt fertig bauen').",
    "- keine doppelten oder bereits vorhandenen tasks (titel-überlapping).",
    "- priorität 5=must-have, 3=should, 1=nice. Default 3.",
    "- meta: kurz erklären warum dieser task wichtig ist (max 80 zeichen).",
    "",
    "Antworte NUR mit dem JSON-Block (keine erklärung davor/danach):",
    "<<<PLAN",
    '{"milestones":[{"name":"M1 …","tasks":[{"title":"...","meta":"...","priority":3}]}]}',
    ">>>",
  ].join("\n");

  const out = await _spawnClaudeReadOnly(project, prompt, { maxBudgetUsd: 0.5 });
  const m = out.match(/<<<PLAN\s*([\s\S]*?)\s*>>>/);
  if (!m) {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn", text: "auto-plan: claude hat kein gültiges JSON geliefert",
    }});
    broadcastState();
    return { ok: false, error: "no JSON" };
  }
  let plan;
  try { plan = JSON.parse(m[1].trim()); }
  catch (e) {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn", text: "auto-plan: JSON parse fehler: " + e.message,
    }});
    broadcastState();
    return { ok: false, error: e.message };
  }
  const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
  let created = 0;
  let skipped = 0;
  for (const ms of milestones) {
    if (!ms || !Array.isArray(ms.tasks)) continue;
    const msName = String(ms.name || "milestone").slice(0, 60);
    for (const t of ms.tasks) {
      if (!t || !t.title) continue;
      const title = String(t.title).slice(0, 200).trim();
      const key = title.toLowerCase().trim();
      if (existingTitles.has(key)) { skipped++; continue; }
      existingTitles.add(key);
      const priority = Math.max(1, Math.min(5, Number(t.priority) || 3));
      const meta = (t.meta ? String(t.meta).slice(0, 80) + " · " : "") + msName;
      applyMutation("ADD_TASK", { projectId, task: {
        title, meta, priority, group: "next", done: false, subtasks: [],
      }});
      created++;
    }
  }
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: created > 0 ? "check" : "warn",
    text: `auto-plan fertig · ${created} tasks erzeugt` + (skipped ? ` · ${skipped} duplikate übersprungen` : ""),
  }});
  broadcastState();
  return { ok: true, created, skipped, milestones: milestones.length };
}

async function runBugHunt(project) {
  const projectId = project.id;
  // Mark scan-start, damit der auto-hunt-watchdog nicht parallel doppelt
  // einen scan startet während dieser noch läuft.
  applyMutation("PATCH_PROJECT", { projectId, patch: { lastBugHuntAt: NOW(), bugHuntRunning: true } });
  applyMutation("ADD_ACTIVITY", { projectId, event: { type: "info", text: "bug-hunt gestartet…" }});
  broadcastState();

  const prompt = [
    "BUG-HUNT für Projekt: " + project.name,
    "",
    "Scanne die Source-Files (mobile-app/lib/, desktop-app/, sync-server/) auf:",
    "- offensichtliche Bugs (typos in Strings, falsche Bedingungen, dead branches)",
    "- UI-Probleme: Buttons ohne Handler, falsche Labels, fehlende loading-states",
    "- Logik-Fehler: race-conditions, off-by-one, missing null-checks",
    "- Security: hardcoded secrets, eval, unsanitized input",
    "",
    "Sei pragmatisch — keine theoretischen Bugs. Nur was wirklich brechen könnte.",
    "Max 8 Findings.",
    "",
    "Antworte nur mit JSON-Block:",
    "<<<BUGS",
    '[{"severity":"low|medium|high","location":"datei:zeile oder pfad","description":"was ist kaputt","fix":"so behebt man es kurz"}, ...]',
    ">>>",
  ].join("\n");

  const out = await _spawnClaudeReadOnly(project, prompt);
  const m = out.match(/<<<BUGS\s*([\s\S]*?)\s*>>>/);
  let count = 0;
  // IDs der NEUEN bugs sammeln. Verhindert race bei concurrent SET_BUG_STATUS
  // calls von anderen sources — vorher wurde nachträglich via filter+slice gefiltert,
  // was bei status-änderungen zwischendurch die falschen bugs picken konnte.
  const newBugIds = [];
  if (m) {
    try {
      const list = JSON.parse(m[1].trim());
      if (Array.isArray(list)) {
        for (const b of list.slice(0, 8)) {
          if (!b || !b.description) continue;
          const id = genId();
          applyMutation("ADD_BUG", { projectId, bug: {
            id,
            severity: ["low","medium","high"].includes(b.severity) ? b.severity : "medium",
            location: String(b.location || "").slice(0, 200),
            description: String(b.description).slice(0, 400),
            fix: String(b.fix || "").slice(0, 400),
            source: "cloud-code",
          }});
          newBugIds.push(id);
          count++;
        }
      }
    } catch (e) {}
  }
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: count > 0 ? "warn" : "check",
    text: `bug-hunt fertig · ${count} bugs gefunden`,
  }});

  // Auto-Fix: für jede neu erzeugte bug-id (nicht für ältere pending) einen task anlegen.
  const proj = state.projects.find(p => p.id === projectId);
  if (proj && proj.bugAutoFix && newBugIds.length) {
    const lookup = new Map((proj.bugs || []).map(b => [b.id, b]));
    let opened = 0;
    for (const id of newBugIds) {
      const b = lookup.get(id);
      if (!b || b.status !== "pending") continue; // schon manuell verworfen?
      applyMutation("ADD_TASK", { projectId, task: {
        title: `[bug-fix] ${b.description.slice(0, 120)}` + (b.location ? ` (${b.location})` : ""),
        done: false,
        group: "next",
        meta: "bug-fix · " + b.severity,
        priority: b.severity === "high" ? 5 : b.severity === "medium" ? 4 : 3,
        bugId: b.id,
        subtasks: [],
      }});
      applyMutation("SET_BUG_STATUS", { projectId, bugId: b.id, status: "fixing" });
      opened++;
    }
    if (opened) {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "info",
        text: `auto-fix: ${opened} bug-tasks angelegt — cloud-code arbeitet sie automatisch ab`,
      }});
    }
  }
  // Run komplett, hunt-flag zurücksetzen damit auto-scan den nächsten cycle macht.
  applyMutation("PATCH_PROJECT", { projectId, patch: { bugHuntRunning: false } });
  broadcastState();
}

// Auto-Bug-Hunt-Watchdog: scannt projekte mit bugAutoFix=on periodisch,
// damit der user nicht jedes mal manuell '🐞 hunt' klicken muss.
// Intervall 30min, skipped wenn bugHuntRunning oder cc gerade busy ist
// auf diesem projekt.
const BUG_AUTOSCAN_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2h zwischen scans (war 30min — zu aggressiv)
setInterval(() => {
  if (!state.ccRunning) return; // cc paused → nicht autoscanen
  if (NOW() < _ccApiLimitedUntil) return; // api-limit aktiv
  const now = NOW();
  for (const project of state.projects) {
    if (!project.bugAutoFix) continue;
    if (project.bugHuntRunning) continue; // bereits am scannen
    if (_isProjectBusy(project.id)) continue; // cc arbeitet gerade
    if (!project.path || !fs.existsSync(project.path)) continue;
    const last = project.lastBugHuntAt || 0;
    if (now - last < BUG_AUTOSCAN_INTERVAL_MS) continue;
    console.log("[auto-bughunt] starte für", project.name, "(letzter scan:", last ? new Date(last).toLocaleString() : "nie", ")");
    runBugHunt(project).catch(e => {
      console.log("[auto-bughunt] error:", e.message);
      applyMutation("PATCH_PROJECT", { projectId: project.id, patch: { bugHuntRunning: false } });
    });
  }
}, 5 * 60 * 1000); // alle 5min checken, gescant wird aber nur alle 30min

// ─── Self-Review ────────────────────────────────────────────
// Zweiter claude-Pass: lässt den eigenen Output kritisch prüfen. Liefert
// {ok: bool, issues: string[], confidence: number}. Bei review-fail wird der
// task NICHT auto-checked. Default-Verhalten bei error: ok=true (fail-open).
async function runSelfReview(project, taskId, taskStatus, originalOutput) {
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return { ok: true, issues: [], confidence: 0.5 };

  // Bug-fix: kein silent fallback auf sync-server/. Wenn der projekt-pfad
  // weg ist, ist review eh sinnlos (keine files zum nachlesen) → fail-open.
  if (!project.path || !fs.existsSync(project.path)) {
    console.log("[review] skip: project.path fehlt/invalid für " + project.name);
    return { ok: true, issues: [], confidence: 0.5 };
  }
  const cwd = project.path;
  const claudeBin = resolveClaudeBinary();

  const filesChanged = (taskStatus.filesChanged || []).slice(0, 10);
  const reviewPrompt = [
    "SELF-REVIEW: Du hast gerade folgende Aufgabe bearbeitet:",
    `> ${task.title}`,
    "",
    "Deine eigene Zusammenfassung war:",
    `> ${taskStatus.summary || "(keine)"}`,
    "",
    filesChanged.length ? `Geänderte Dateien: ${filesChanged.join(", ")}` : "Keine Dateien geändert.",
    "",
    "Prüfe jetzt KRITISCH dein Ergebnis. Lies die geänderten Dateien (Read-Tool)",
    "und prüfe auf:",
    "1. Build-Errors: fehlende imports, syntax-fehler, falsche typen",
    "2. UI-Konsistenz: passt das Design zu existierenden Screens? Lesbare Farben?",
    "3. Halbfertiges: vergessene TODO-Marker, unbenutzte refs, dead code",
    "4. Aufgabe wirklich erfüllt: erfüllt das Code-Ergebnis, was die Aufgabe wollte?",
    "",
    `Sei ehrlich. Lieber „issues gefunden" als schlechten Code akzeptieren.`,
    "",
    "Antworte SEHR KURZ (max 100 Wörter) und am Ende mit JSON-Block:",
    "<<<REVIEW",
    '{"ok":true|false,"issues":["...","..."],"confidence":0.0-1.0}',
    ">>>",
  ].join("\n");

  const args = [
    "--print",
    "--permission-mode", "bypassPermissions",
    "--dangerously-skip-permissions",
    "--tools", "default",
    "--add-dir", cwd,
  ];
  const mcpConfigPath = resolveMcpConfig({ baseDir: __dirname });
  if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);

  return new Promise((resolve) => {
    // Defense-in-depth: cwd aus project.path → cmd.exe würde Metazeichen
    // im --add-dir-Argument bzw. cwd als Befehlstrenner deuten.
    try { assertSafeProjectPath(cwd, "review.cwd"); }
    catch (e) {
      console.log("[review] unsicherer cwd, fail-open:", e.message);
      cleanupResolvedConfig(mcpConfigPath);
      return resolve({ ok: true, issues: [], confidence: 0.5 });
    }
    const proc = spawn(claudeBin, args, {
      cwd, shell: true, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...userSettings.envOverlay() },
    });
    let out = "";
    proc.stdout.on("data", (c) => { out += c.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("error", () => { cleanupResolvedConfig(mcpConfigPath); resolve({ ok: true, issues: [], confidence: 0.5 }); });
    proc.on("close", (code) => {
      cleanupResolvedConfig(mcpConfigPath);
      if (code !== 0) return resolve({ ok: true, issues: [], confidence: 0.5 });
      const m = out.match(/<<<REVIEW\s*([\s\S]*?)\s*>>>/);
      if (!m) return resolve({ ok: true, issues: [], confidence: 0.5 });
      try {
        const r = JSON.parse(m[1].trim());
        resolve({
          ok: r.ok !== false,
          issues: Array.isArray(r.issues) ? r.issues : [],
          confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
        });
      } catch (e) { resolve({ ok: true, issues: [], confidence: 0.5 }); }
    });
    proc.stdin.write(reviewPrompt);
    proc.stdin.end();
  });
}

// ─── Auto-Mobile-Rebuild ────────────────────────────────────
// Sucht flutter.bat unter ProjectGamma/Flutter/flutter/bin/. Falls vorhanden:
// flutter build apk --debug (incremental, ~5-10s wenn nichts gravierend
// geändert) → adb install -r → adb am start. Komplett async, blockiert
// die nächste auto-pump-Iteration nicht.
const _mobileRebuilds = new Map(); // projectId -> Promise (rate-limit)
async function rebuildMobileApp(projectId, project) {
  if (_mobileRebuilds.has(projectId)) return; // läuft schon
  // Defense-in-depth: project.path landet in spawn-cwd und in flutterBin.
  // Bei shell:true würde cmd.exe Metazeichen als Befehlstrenner deuten.
  try {
    assertSafeProjectPath(project.path, "rebuild.project.path");
  } catch (e) {
    console.log("[autorebuild] unsicherer project.path, abort:", e.message);
    return;
  }
  const mobileDir = path.join(project.path, "mobile-app");
  if (!fs.existsSync(mobileDir)) {
    console.log("[autorebuild] no mobile-app/ in", project.path);
    return;
  }

  // Flutter-Bin finden (Default: ProjectGamma/Flutter/flutter/bin/flutter.bat)
  const flutterBin = path.join(project.path, "Flutter", "flutter", "bin",
    process.platform === "win32" ? "flutter.bat" : "flutter");
  if (!fs.existsSync(flutterBin)) {
    console.log("[autorebuild] flutter not found:", flutterBin);
    return;
  }

  const work = (async () => {
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "info",
      text: "auto-rebuild apk gestartet…",
    }});
    broadcastState();

    // 1) flutter build apk --debug
    const t0 = NOW();
    // Defense-in-depth: cwd & bin werden hier durch cmd.exe geleitet (shell:true).
    // Auch wenn project.path oben validiert wurde, kann path.join veraltete
    // state.json-Einträge weitertragen — daher unmittelbar vor spawn nochmal hart prüfen.
    assertSafeProjectPath(mobileDir, "rebuild.cwd");
    assertSafeProjectPath(flutterBin, "rebuild.flutterBin");
    const buildOk = await new Promise((resolve) => {
      const p = spawn(flutterBin, ["build", "apk", "--debug"], {
        cwd: mobileDir, shell: true, windowsHide: true,
      });
      let err = "";
      p.stderr.on("data", (c) => { err += c.toString(); });
      p.on("close", (code) => resolve(code === 0));
      p.on("error", () => resolve(false));
    });

    const buildMs = NOW() - t0;
    if (!buildOk) {
      console.log("[autorebuild] flutter build failed");
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "warn",
        text: "auto-rebuild apk fehlgeschlagen",
      }});
      broadcastState();
      return;
    }

    const apkPath = path.join(mobileDir, "build", "app", "outputs", "flutter-apk", "app-debug.apk");
    if (!fs.existsSync(apkPath)) {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "warn", text: "apk-datei nicht gefunden nach build",
      }});
      broadcastState();
      return;
    }

    // 2) adb install -r --user 0 (verhindert Doppel-Install in Samsung-Dual-App-Profil 95)
    // apkPath wird durch cmd.exe geleitet → shell-metazeichen erneut blocken.
    assertSafeProjectPath(apkPath, "rebuild.apkPath");
    const installOk = await new Promise((resolve) => {
      const p = spawn("adb", ["install", "-r", "--user", "0", apkPath], {
        shell: true, windowsHide: true,
      });
      p.on("close", (code) => resolve(code === 0));
      p.on("error", () => resolve(false));
    });

    if (installOk) {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "check",
        text: `apk auto-installiert (${Math.round(buildMs / 100) / 10}s)`,
      }});
      applyMutation("ADD_SYNC_LOG", { entry: {
        source: "system", projectId,
        text: "apk auto-installiert auf phone",
      }});
      // Bonus: App neu starten für sofortige Sichtbarkeit
      spawn("adb", ["shell", "am", "start", "-n",
        "com.gexanx.projectgamma.projectgamma_mobile/.MainActivity",
        "--user", "0"], { shell: true, windowsHide: true });
    } else {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "info",
        text: `apk gebaut (${Math.round(buildMs / 100) / 10}s) · phone-install nicht möglich (kein device)`,
      }});
    }
    broadcastState();
  })();

  _mobileRebuilds.set(projectId, work);
  work.finally(() => _mobileRebuilds.delete(projectId));
  return work;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// ─── WebSocket-Layer ────────────────────────────────────────
// HTTPS wenn TLS aktiv, sonst klar-HTTP (default; kompatibel zum bisherigen flow).
const server = TLS_INFO.httpsOptions
  ? https.createServer(TLS_INFO.httpsOptions, app)
  : http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// WS-Heartbeat (audit-fix): pingt jede 30s, schließt connections die nicht
// pongen. Verhindert leak von „dead" half-open sockets in wss.clients.
setInterval(() => {
  if (!wss || !wss.clients) return;
  for (const c of wss.clients) {
    if (c.readyState !== 1) continue;
    if (c._isAlive === false) { try { c.terminate(); } catch (_) {} continue; }
    c._isAlive = false;
    try { c.ping(); } catch (_) {}
  }
}, 30_000);

wss.on("connection", (ws, req) => {
  ws._isAlive = true;
  ws.on("pong", () => { ws._isAlive = true; });
  ws.on("error", (e) => { console.log("[ws] error:", e && e.message); });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  // Akzeptiert pair-token (legacy) ODER user-token (multi-user schicht 1).
  let sess = null;
  if (token && sessions.has(token)) {
    sess = sessions.get(token);
  } else if (token && usersStore) {
    const us = usersStore.resolveSession(token);
    if (us) {
      const user = usersStore.findUserById(us.userId);
      if (user) {
        sess = {
          deviceName: user.email,
          deviceType: "user",
          since: us.expiresAt - USER_SESSION_TTL_MS,
          lastSeen: NOW(),
          userId: user.id,
        };
      }
    }
  }
  if (!sess) {
    ws.send(JSON.stringify({ type: "ERROR", error: "unauthorized" }));
    ws.close();
    return;
  }
  ws._token = token;
  ws._device = sess.deviceName;
  ws._session = sess; // wird von broadcastState() für per-client-filter genutzt

  console.log("[ws] connected:", sess.deviceName);
  ws.send(JSON.stringify({ type: "STATE", state: publicState(sess) }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      // Bug-fix: jede WS-nachricht muss lastSeen der pair-session bumpen,
      // sonst zeigt das device-panel "offline" obwohl die WS-verbindung
      // lebendig pingt. Pair-sessions liegen in der sessions-map und werden
      // sonst nur durch HTTP-requests aktualisiert (nicht durch WS).
      if (ws._token && sessions.has(ws._token)) {
        sessions.get(ws._token).lastSeen = NOW();
      }
      if (msg.type === "PING") {
        ws.send(JSON.stringify({ type: "PONG", ts: NOW() }));
        return;
      }
      if (msg.type === "MUT" && msg.mutation) {
        // Re-Validierung des tokens (pair-session oder user-session).
        // Pair-session: live aus sessions-map; user-session: via usersStore.
        let liveSess = resolveLiveSession(sessions, ws._token);
        if (!liveSess && usersStore && ws._token) {
          const us = usersStore.resolveSession(ws._token);
          if (us) {
            const user = usersStore.findUserById(us.userId);
            if (user) {
              liveSess = {
                deviceName: user.email,
                deviceType: "user",
                since: ws._session?.since || NOW(),
                lastSeen: NOW(),
                userId: user.id,
              };
            }
          }
        }
        if (!liveSess) {
          ws.send(JSON.stringify({ type: "ERROR", error: "session_revoked" }));
          ws.close();
          return;
        }
        // Schicht-2 autorisierung: user-sessions brauchen rolle aufs projekt.
        const access = checkMutationAccess(
          msg.mutation.type, msg.mutation.payload, liveSess, memberships,
        );
        if (!access.ok) {
          ws.send(JSON.stringify({ type: "ERROR", error: access.reason }));
          return;
        }
        applyMutation(msg.mutation.type, msg.mutation.payload, { session: liveSess });
        // ADD_PROJECT via WS: anlegenden user als owner setzen.
        // Bugfix: state.projects[length-1] war fragil — bei parallelen ADD_PROJECT
        // (oder künftigem async-refactor) könnte ein anderes projekt erwischt
        // werden. MUT.ADD_PROJECT pusht dieselbe object-ref aus payload.project
        // und setzt id inline → direkter payload-zugriff ist eindeutig.
        if (msg.mutation.type === "ADD_PROJECT" && liveSess.userId && memberships) {
          const created = msg.mutation.payload && msg.mutation.payload.project;
          if (created && created.id) {
            try {
              memberships.addMember({
                projectId: created.id, userId: liveSess.userId,
                role: ROLES.OWNER, addedBy: liveSess.userId,
              });
            } catch (e) { console.warn("[membership] add owner failed:", e.message); }
          }
        }
        broadcastState();
        // CC-Toggle on → Auto-Pump-Kick + Cool-Downs leeren damit „fortsetzen"
        // wirklich sofort den nächsten Task aufnimmt.
        if (msg.mutation.type === "TOGGLE_CC" && msg.mutation.payload?.running === true) {
          _autoPumpCooldowns.clear();
          setImmediate(() => { try { autoPumpTick(); } catch (e) {} });
        }
      }
    } catch (e) {
      console.error("[ws] bad message:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("[ws] closed:", sess.deviceName);
  });
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

// Pro-client gefilterter broadcast für projekt-scoped frames (CC_OUTPUT,
// CC_STATUS, CC_THINKING, PUSH_NOTIFICATION). Audit-fix: bisher leakte
// cc-stdout an alle WS-clients egal ob projekt-mitglied. Jetzt nur an
// clients die das projekt sehen dürfen (pair-session = all access).
function broadcastForProject(msg, projectId) {
  if (!projectId) { broadcast(msg); return; }
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const sess = client._session;
    if (sess && sess.userId && memberships) {
      if (!memberships.hasRole(projectId, sess.userId, ROLES.VIEWER)) continue;
    }
    try { client.send(data); } catch (_) {}
  }
}

// Pro-client gefilterter STATE-broadcast. Pair-clients bekommen full state,
// user-clients nur projekte, in denen sie member sind. Wird statt
// `broadcast({type:"STATE",state:publicState()})` aufgerufen.
// Fix A · broadcastState 50ms-debounce + coalesce:
// Bei cc-runs werden ~50 broadcastState() pro stream-job ausgelöst.
// Mit debounce wird daraus EIN broadcast pro 50ms-fenster → 10-20× weniger
// WS-traffic + react/flutter-renders. Final-events sind sync (immediate)
// damit der user kein lag bei task-completion fühlt.
let _broadcastTimer = null;
let _broadcastQueued = false;
function _doBroadcastState() {
  _broadcastQueued = false;
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    try {
      client.send(JSON.stringify({
        type: "STATE", state: publicState(client._session),
      }));
    } catch (_) {}
  }
}
function broadcastState(opts) {
  // opts.immediate: für final-events (task-complete, login etc.) ohne lag
  if (opts && opts.immediate) {
    if (_broadcastTimer) { clearTimeout(_broadcastTimer); _broadcastTimer = null; }
    _doBroadcastState();
    return;
  }
  _broadcastQueued = true;
  if (_broadcastTimer) return; // schon im flight
  _broadcastTimer = setTimeout(() => {
    _broadcastTimer = null;
    if (_broadcastQueued) _doBroadcastState();
  }, 50);
}

// MCP-warmup: beim server-boot 1× im hintergrund alle MCP-server-packages
// via `npx -y` antippen. das primt den npm-cache → nächste cc-spawns starten
// sofort statt 30-60s npm-download zu warten. read-only, kein server-listen
// (kommando bricht nach 2s ab, package ist dann gecached).
function _warmupMcpCache() {
  let mcp;
  try { mcp = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "mcp.json"), "utf8")); }
  catch (_) { return; }
  const servers = (mcp && mcp.mcpServers) || {};
  const seen = new Set();
  const pkgs = [];
  for (const [name, def] of Object.entries(servers)) {
    // env-var-gated server überspringen (REF_API_KEY, GITHUB_PAT)
    const env = def?.env || {};
    if (Object.values(env).some(v => typeof v === "string" && /^\$\{[A-Z_]+\}$/.test(v))) continue;
    const args = def?.args || [];
    // pkgname extrahieren: erstes arg das nicht mit - beginnt
    const pkg = args.find(a => typeof a === "string" && !a.startsWith("-"));
    if (pkg && !seen.has(pkg)) { seen.add(pkg); pkgs.push({ name, pkg }); }
  }
  if (pkgs.length === 0) return;
  console.log("[mcp-warmup] prime cache für", pkgs.length, "MCP-pakete (~5-30s im hintergrund) ...");
  const { spawn } = require("node:child_process");
  let done = 0;
  for (const { name, pkg } of pkgs) {
    // Wir benutzen `npm view <pkg>` statt `npx -y <pkg>` weil:
    //   - npm view triggert keinen package-execute (sicherer)
    //   - aber npm view triggert auch keinen DOWNLOAD ins cache.
    //   - daher: `npm install --no-save --silent <pkg>@latest` würde den
    //     cache füllen, ist aber slow.
    //   - simpelste lösung: `npx -y --no-install <pkg> --help` schlägt
    //     fehl wenn nicht gecached → wir nutzen `npx -y <pkg> --version`
    //     mit kurzem timeout. wenn timeout: trotzdem ist package nach
    //     download im cache.
    let proc;
    try {
      proc = spawn("npx", ["-y", pkg, "--version"], {
        // Node 24 verlangt shell:true für .cmd/.bat auf Windows.
        shell: true, windowsHide: true, stdio: "ignore",
        env: process.env,
      });
    } catch (e) {
      console.warn("[mcp-warmup] spawn fehler für", pkg, ":", e.message);
      done++;
      continue;
    }
    const killTimer = setTimeout(() => { try { proc.kill(); } catch (_) {} }, 60_000);
    proc.on("exit", () => {
      clearTimeout(killTimer);
      done++;
      if (done === pkgs.length) console.log("[mcp-warmup] cache primed (" + done + "/" + pkgs.length + ")");
    });
    proc.on("error", () => {
      clearTimeout(killTimer);
      done++;
    });
  }
}

// ─── Boot ──────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  const ifaces = require("os").networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list) if (i.family === "IPv4" && !i.internal) ips.push(i.address);
  }
  console.log("");
  const httpScheme = TLS_INFO.mode === "off" ? "http" : "https";
  const wsScheme = TLS_INFO.mode === "off" ? "ws" : "wss";
  console.log("┌─ ProjectGamma Sync-Server ───────────────────────");
  console.log("│  TLS:", TLS_INFO.mode, TLS_INFO.fingerprint ? "fp=" + TLS_INFO.fingerprint.slice(0, 12) + "..." : "");
  console.log("│  " + httpScheme + "://localhost:" + PORT);
  for (const ip of ips) console.log("│  " + httpScheme + "://" + ip + ":" + PORT + "  (LAN)");
  console.log("│  " + wsScheme + "://...:" + PORT + "/ws?token=...");
  console.log("│  projects:", state.projects.length, " sessions:", sessions.size);
  console.log("└──────────────────────────────────────────────────");
  console.log("");
  // MCP-cache async warmup — verhindert dass der erste cc-spawn 30-60s
  // auf npm-downloads von context7/sequential-thinking/etc wartet.
  setTimeout(_warmupMcpCache, 2000);
});
