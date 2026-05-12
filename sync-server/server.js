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
const { createUsersStore } = require("./lib/users_store");
const { createProjectMembershipStore, ROLES } = require("./lib/project_membership");
const { hashPassword, verifyPassword } = require("./lib/password_hash");
const { filterStateForSession, checkMutationAccess } = require("./lib/project_access");
const { createOpLogStore } = require("./lib/op_log_store");
const { buildOpAppendFrame, selectRecipients } = require("./lib/op_broadcast");
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
// Strenger als pair-claim (kürzeres window, weniger fails) — login ist deutlich
// schwerer zu erraten als ein 6-stelliger code, also wirkt das limit härter.
const loginRateLimiter = createClaimRateLimiter({ windowMs: 5 * 60 * 1000, maxFails: 5 });

const PORT = Number(process.env.PORT) || 7892;
// TLS bootstrap (default off; aktiv via TLS=1). Self-signed cert in ./tls/.
const TLS_ENABLED = process.env.TLS === "1" || process.env.TLS === "true";
const TLS_DIR = process.env.TLS_DIR || path.join(__dirname, "tls");
const TLS_INFO = bootstrapTls({ enabled: TLS_ENABLED, dir: TLS_DIR });
const STORE_FILE = path.join(__dirname, "store.json");
const STORE_DB_FILE = path.join(__dirname, "store.sqlite");
const { createSqliteStore } = require("./lib/sqlite_store");
const PAIRING_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

// ─── State + Persistenz ──────────────────────────────────────
const NOW = () => Date.now();
const uid = () => crypto.randomBytes(4).toString("hex");

function defaultState() {
  const t0 = NOW();
  const defaultPath = resolveDefaultProjectPath(__dirname);
  if (!defaultPath) {
    console.warn("[store] kein default-projektpfad ermittelbar — projekt wird ohne pfad angelegt; cloud-code startet erst nach manuellem path-set");
  }
  return {
    projects: [
      {
        id: "projectgamma",
        name: "ProjectGamma",
        description: "Flutter/Dart Projekt-Manager mit Cloud-Code-Integration. Mobile + Desktop-Sync.",
        starred: true, tech: "flutter",
        path: defaultPath || "",
        lastSync: t0 - 2 * 60 * 1000,
        goals: [
          "mobile + desktop synchronisieren",
          "cloud-code arbeitet autonom im projekt",
          "ideen aus dem alltag erfassen",
          "regeln werden bei jeder änderung respektiert",
        ],
        files: [
          { id: uid(), name: "lib/", depth: 0 },
          { id: uid(), name: "features/", depth: 1 },
          { id: uid(), name: "auth/", depth: 2 },
          { id: uid(), name: "sync/", depth: 2 },
          { id: uid(), name: "ideas/", depth: 2 },
          { id: uid(), name: "tasks/", depth: 2 },
          { id: uid(), name: "shared/", depth: 1 },
          { id: uid(), name: "test/", depth: 0 },
          { id: uid(), name: "pubspec.yaml", depth: 0 },
          { id: uid(), name: "README.md", depth: 0 },
        ],
        tasks: [
          { id: uid(), title: "refactor auth-modul nach regel #3", done: false, group: "in_progress", meta: "hoch",
            subtasks: [
              { id: uid(), title: "tokens kapseln", done: true },
              { id: uid(), title: "session-store extrahieren", done: true },
              { id: uid(), title: "tests anpassen", done: false },
            ] },
          { id: uid(), title: "sync-konflikt mobile ↔ desktop lösen", done: false, group: "in_progress", meta: "hoch", subtasks: [] },
          { id: uid(), title: "ideen-inbox: voice-transkription verbinden", done: false, group: "in_progress", meta: "mittel", subtasks: [] },
          { id: uid(), title: "checkmark-history-view bauen", done: false, group: "next", meta: "cc-vorschlag", subtasks: [] },
          { id: uid(), title: "keyboard-shortcuts dokumentieren", done: false, group: "next", meta: "", subtasks: [] },
        ],
        rules: [
          { id: uid(), category: "code-stil", text: "kein unnötiger code", active: true },
          { id: uid(), category: "code-stil", text: "snake_case für dateien", active: true },
          { id: uid(), category: "code-stil", text: "max. 200 zeilen pro file", active: true },
          { id: uid(), category: "code-stil", text: "öffentliche api dokumentiert", active: true },
          { id: uid(), category: "architektur", text: "bestehende ordnerstruktur respektieren", active: true },
          { id: uid(), category: "architektur", text: "feature-first organisation", active: true },
          { id: uid(), category: "architektur", text: "domain ↔ infra trennung", active: true },
          { id: uid(), category: "workflow", text: "keine änderung ohne checkmark", active: true },
          { id: uid(), category: "workflow", text: "mobile + desktop sync beachten", active: true },
        ],
        ideas: [
          { id: uid(), text: "füge ein belohnungssystem hinzu", status: "unprocessed", source: "mobile", createdAt: t0 - 2 * 60 * 1000 },
          { id: uid(), text: "onboarding kürzer machen", status: "task_created", source: "mobile", createdAt: t0 - 4 * 3600 * 1000 },
          { id: uid(), text: "haptic feedback bei checkmark", status: "processed", source: "mobile", createdAt: t0 - 26 * 3600 * 1000 },
        ],
        activity: [],
      },
    ],
    syncLog: [],
    lastFullSync: NOW(),
    ccRunning: true,
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
// "done" und "ohne pfad" werden geskippt. Cool-down 90s pro Task gegen Loops.
const _autoPumpCooldowns = new Map(); // taskId -> ts
const _autoPumpMissingPathWarned = new Set(); // projectId -> 1× warnen statt 25s-spam
let _ccApiLimitedUntil = 0; // ts — wenn claude API limit reached, pause auto-pump bis dahin
async function autoPumpTick() {
  if (!state.ccRunning) return;
  if (NOW() < _ccApiLimitedUntil) return; // claude API limit reached — warten
  for (const project of state.projects) {
    if (ccJobs.has(project.id)) continue;
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
      return NOW() - last > 90_000;
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
    break;
  }
}
setInterval(autoPumpTick, 25 * 1000);

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
  SET_PENDING_QUESTION(s, { projectId, question }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, pendingQuestion: String(question || "").slice(0, 1000),
      pendingQuestionAt: NOW(),
    }));
  },
  CLEAR_PENDING_QUESTION(s, { projectId }) {
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, pendingQuestion: null, pendingQuestionAt: null,
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
    s.projects = s.projects.map(p => p.id !== projectId ? p : ({
      ...p, bugs: [bug, ...(p.bugs || [])].slice(0, 100),
    }));
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
      const lastMsg = proj && proj.messages && proj.messages[proj.messages.length - 1];
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
    // Beim ADD_PROJECT hat das gerade angelegte project schon eine id, weil
    // MUT.ADD_PROJECT sie inline generiert. State ist bereits gespeichert.
    const last = state.projects[state.projects.length - 1];
    return last ? last.id : null;
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
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch (_) {}
    }
  }
}

// ─── HTTP-Layer ─────────────────────────────────────────────
const app = express();
app.use(cors());
// json-body-limit hoch: 8 MB für base64-attachments (bilder)
app.use(express.json({ limit: "8mb" }));

// Root: Browser-Anfragen landen oft hier statt auf Port 7891 (Desktop-UI).
// Statt "Cannot GET /" leiten wir zur Desktop-App auf demselben Host weiter
// bzw. zeigen einen klaren Hinweis für API-Clients.
app.get("/", (req, res) => {
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

// Cloudflare Tunnel control — desktop-only (lokal/trusted).
app.post("/api/tunnel/start", authMw, async (req, res) => {
  if (!isDesktopSession(req.session)) return res.status(403).json({ error: "desktop session required" });
  const r = await cloudflareTunnel.start();
  res.json(r);
});
app.post("/api/tunnel/stop", authMw, (req, res) => {
  if (!isDesktopSession(req.session)) return res.status(403).json({ error: "desktop session required" });
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

// Desktop-Self-Init: nur über localhost erreichbar, erzeugt Desktop-Session
// ohne Pairing-Code (Desktop ist Trust-Boundary). Idempotent: wenn schon eine
// Desktop-Session mit gleichem Namen existiert, wird der bestehende Token zurückgegeben.
app.post("/api/pair/desktop-init", (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || "";
  const isLocal =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.") || req.hostname === "localhost";
  if (!isLocal) return res.status(403).json({ error: "nur lokal erreichbar" });

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
  const isLocal =
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.") || req.hostname === "localhost";
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
    }
  }
  const sess = usersStore.createSession({ userId: user.id, ttlMs: USER_SESSION_TTL_MS });
  console.log("[auth] register:", user.email);
  res.status(201).json({
    token: sess.token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    expiresAt: sess.expiresAt,
  });
});

app.post("/api/auth/login", async (req, res) => {
  if (!usersStore) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const gate = loginRateLimiter.check(ip);
  if (!gate.allowed) {
    res.set("Retry-After", String(gate.retryAfterSec));
    return res.status(429).json({
      error: "zu viele fehlversuche, später erneut probieren",
      retryAfterSec: gate.retryAfterSec,
    });
  }
  const { email, password } = req.body || {};
  if (!_emailValid(email) || !password || typeof password !== "string") {
    loginRateLimiter.recordFailure(ip);
    return res.status(400).json({ error: "email + passwort erforderlich" });
  }
  const user = usersStore.findUserByEmail(email);
  // timing-anfällige antwort vermeiden: bei unbekanntem user trotzdem hash-cost
  // simulieren wäre overkill; wir geben einfach „ungültige zugangsdaten".
  if (!user || !verifyPassword(password, user.passwordHash)) {
    loginRateLimiter.recordFailure(ip);
    return res.status(401).json({ error: "ungültige zugangsdaten" });
  }
  const sess = usersStore.createSession({ userId: user.id, ttlMs: USER_SESSION_TTL_MS });
  console.log("[auth] login:", user.email);
  res.json({
    token: sess.token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
    expiresAt: sess.expiresAt,
  });
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
  // Sequenziell installieren — npm-globals dürfen nicht parallelisiert werden
  (async () => {
    const installed = [];
    for (const m of npmInstalls) {
      const proc = spawn(npm, ["install", "-g", m.install.npm], { shell: true, windowsHide: true });
      await new Promise((resolve) => {
        proc.on("close", (code) => { if (code === 0) installed.push(m.name); resolve(); });
        proc.on("error", () => resolve());
      });
    }
    res.json({ ok: true, installed, manualSteps });
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
    // ADD_PROJECT: anlegenden user automatisch als owner zum projekt hinzufügen
    if (type === "ADD_PROJECT" && req.session && req.session.userId && memberships) {
      const created = state.projects[state.projects.length - 1];
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
  res.json({ projectId: project.id, members: out });
});

app.post("/api/projects/:id/members", authMw, (req, res) => {
  if (!memberships || !usersStore) return res.status(503).json({ error: "multi-user nicht aktiv" });
  const project = state.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.OWNER)) return;
  const { email, role } = req.body || {};
  if (!email || typeof email !== "string") return res.status(400).json({ error: "email fehlt" });
  const target = usersStore.findUserByEmail(email);
  if (!target) return res.status(404).json({ error: "user nicht gefunden" });
  const r = (role && [ROLES.OWNER, ROLES.MEMBER, ROLES.VIEWER].includes(role)) ? role : ROLES.MEMBER;
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
  persistSessions();
  // Trenne ggf. offene WS für diesen Token
  for (const c of wss.clients) {
    if (c._token === req.token) try { c.close(); } catch (e) {}
  }
  res.json({ ok: true });
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
  if (ccJobs.has(projectId)) { const e = new Error("cloud-code läuft bereits"); e.status = 409; throw e; }
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

  const cwd = project.path && fs.existsSync(project.path) ? project.path : process.cwd();
  const task = taskId ? project.tasks.find(t => t.id === taskId) : null;

  // Prompt zusammenstellen aus Projekt-Kontext (Regeln, Ziele, Aufgabe).
  // Bitte claude am Ende einen JSON-Block mit Regel-Vorschlägen auszugeben,
  // den der Server parsed und als „cc-vorschlag"-Regeln erstellt (inaktiv).
  const activeRules = project.rules.filter(r => r.active).map(r => "- " + r.text);
  const inactiveRules = project.rules.filter(r => !r.active).map(r => "- " + r.text);
  // Tombstones: regeln, die der user kürzlich entfernt hat. Damit cc nicht
  // unbedacht dieselben texte als RULE_SUGGESTIONS wieder vorschlägt.
  const removedRules = (project.removedRules || []).slice(0, 10).map(r => "- " + r.text);
  const goals = project.goals || [];
  const fullPrompt = [
    "Arbeite am Projekt: " + project.name + " (" + project.tech + ").",
    "",
    goals.length ? "PROJEKTZIELE:\n" + goals.map(g => "- " + g).join("\n") : "",
    activeRules.length ? "AKTIVE REGELN (immer einhalten):\n" + activeRules.join("\n") : "",
    inactiveRules.length ? "INAKTIVE REGELN (zur info):\n" + inactiveRules.join("\n") : "",
    removedRules.length ? "KÜRZLICH ENTFERNTE REGELN (NICHT erneut vorschlagen):\n" + removedRules.join("\n") : "",
    "",
    "AUFGABE:",
    task ? task.title : (prompt || "Was wäre als nächstes sinnvoll? Gib einen kurzen Plan in 3-5 Punkten."),
    task && prompt ? "\nZUSATZ: " + prompt : "",
    "",
    "WICHTIG: Halte deine Antwort kurz (max. 250 Wörter). Du DARFST und SOLLST",
    "Dateien lesen und schreiben (bypassPermissions ist aktiv) um die Aufgabe",
    "zu erledigen. Halte alle aktiven Regeln strikt ein.",
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
    "4) WENN du eine wichtige rückfrage zum projekt hast (z.B. unklare anforderung,",
    "   technologie-entscheidung, naming-konflikt), darfst du EINE frage stellen:",
    "<<<QUESTION",
    "Deine konkrete frage in 1-3 sätzen.",
    ">>>",
    "Stelle KEINE rückfragen für triviale entscheidungen — wenn du das selbst",
    "entscheiden kannst, mach es. Frage NUR wenn die wahl signifikant ist und",
    "der user wahrscheinlich eine meinung hat. Falls du fragst: kennzeichne",
    "TASK_STATUS done=false und beschreibe was du noch nicht entschieden hast.",
  ].filter(Boolean).join("\n");

  // Versuche claude CLI zu starten. Auf Windows den vollen Pfad zur npm-globalen
  // claude.cmd suchen, falls "claude" nicht im PATH ist.
  function resolveClaudeBin() {
    if (process.platform !== "win32") return "claude";
    const tryPaths = [
      path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
      path.join(process.env.APPDATA || "", "npm", "claude.ps1"),
      "claude.cmd",
      "claude",
    ];
    for (const p of tryPaths) {
      if (p && fs.existsSync(p)) return p;
    }
    return "claude.cmd";
  }
  const claudeBin = resolveClaudeBin();
  console.log("[cc] using claude bin:", claudeBin);

  // Prompt in temporärer Datei → claude mit -p "@file" oder via stdin pipe.
  // Stdin ist robuster auf Windows als ein cmd-Arg mit Newlines/Umlauten.
  // MCP-Konfig: gibt claude Zugriff auf filesystem, sequential-thinking,
  // context7 (lib-docs), puppeteer (browser-automation), code-runner,
  // ref-tools. Konfig liegt neben server.js.
  // MCP-Konfig dynamisch auflösen: server ohne gesetzte env-vars (z.b.
  // ref-tools ohne REF_API_KEY) werden gefiltert, sonst hängt claude beim
  // tool-call.
  const mcpConfigPath = resolveMcpConfig({ baseDir: __dirname });
  const args = [
    "--print",
    "--permission-mode", "bypassPermissions",
    "--dangerously-skip-permissions",
    "--tools", "default",
    "--add-dir", cwd,
    // Hard-Budget pro Task (Sicherung gegen Runaway)
    "--max-budget-usd", String(state.ccBudget?.perTaskUsd ?? 2.0),
  ];
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

  const job = { proc, startedAt: NOW(), taskId, prompt: fullPrompt, lines: [], cwd };
  ccJobs.set(projectId, job);
  console.log("[cc] start", projectId, "in", cwd, "task:", task?.title || prompt);

  // Activity-Eintrag „Cloud-Code gestartet"
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: "info",
    text: "cloud-code gestartet" + (task ? ": <i>" + escapeHtml(task.title) + "</i>" : ""),
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

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    job.lines.push(text);
    // Bugfix (UI): protocol-marker (<<<TASK_PLAN, <<<TASK_STATUS,
    // <<<RULE_SUGGESTIONS, <<<QUESTION) NICHT als rohtext ins UI streamen.
    job.inProtocolBlock = job.inProtocolBlock || false;
    const cleanLines = [];
    for (const raw of text.split(/\r?\n/)) {
      if (/^<<<(TASK_PLAN|TASK_STATUS|RULE_SUGGESTIONS|QUESTION)/.test(raw)) {
        job.inProtocolBlock = true; continue;
      }
      if (job.inProtocolBlock) {
        if (raw.trim() === ">>>") job.inProtocolBlock = false;
        continue;
      }
      if (raw.trim() === ">>>") continue; // safety
      cleanLines.push(raw);
    }
    const cleanText = cleanLines.join("\n");
    broadcastForProject({ type: "CC_OUTPUT", projectId, chunk: cleanText }, projectId);
    cleanLines.filter(Boolean).slice(0, 3).forEach(line => {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "write",
        text: "cc: " + escapeHtml(line.slice(0, 200)),
      }});
    });

    // TASK_PLAN parsen sobald sichtbar (einmalig pro Job): zeigt Sub-Tasks
    // schon während claude noch arbeitet. Wir merken planParsed=true im Job.
    if (!job.planParsed && taskId) {
      const fullSoFar = job.lines.join("");
      const planM = fullSoFar.match(/<<<TASK_PLAN\s*([\s\S]*?)\s*>>>/);
      if (planM) {
        job.planParsed = true;
        try {
          const plan = JSON.parse(planM[1].trim());
          if (Array.isArray(plan.steps)) {
            const cleanSteps = plan.steps.map(s => String(s).replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean).slice(0, 8);
            cleanSteps.forEach(stepText => {
              applyMutation("ADD_SUBTASK", { projectId, taskId, subtask: { title: stepText, done: false } });
            });
            applyMutation("ADD_ACTIVITY", { projectId, event: {
              type: "info",
              text: `cc plan: ${cleanSteps.length} schritte`,
            }});
          }
        } catch (e) { console.log("[cc] task_plan parse failed:", e.message); }
      }
    }

    broadcastState();
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    job.lines.push("[stderr] " + text);
    broadcastForProject({ type: "CC_OUTPUT", projectId, chunk: text, stream: "stderr" }, projectId);
  });

  proc.on("close", (code) => {
    ccJobs.delete(projectId);
    if (job._thinkingTimer) { clearInterval(job._thinkingTimer); job._thinkingTimer = null; }
    cleanupResolvedConfig(mcpConfigPath);
    console.log("[cc] done", projectId, "exit", code);

    const fullOutput = job.lines.join("");

    // Claude-API-Limit erkennen → Auto-Pump für 10 Minuten pausieren
    // damit nicht endlos fehlgeschlagene Calls gefeuert werden.
    if (/hit your limit|rate limit|usage limit/i.test(fullOutput)) {
      _ccApiLimitedUntil = NOW() + 10 * 60 * 1000;
      console.log("[autopump] claude API limited — pausiere bis", new Date(_ccApiLimitedUntil).toLocaleTimeString());
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "warn",
        text: "claude-api limit erreicht · auto-pump pausiert für 10min",
      }});
    }

    // Token-Schätzung (claude --output-format text → wir parsen nicht direkt
    // sondern schätzen 1 token ≈ 4 chars). Cost: Sonnet-4 Pricing als Default.
    const inputTokens = Math.round(fullPrompt.length / 4);
    const outputTokens = Math.round(fullOutput.length / 4);
    const PRICE_IN = 3.0 / 1_000_000;   // $3/MTok input  (Sonnet 4.x)
    const PRICE_OUT = 15.0 / 1_000_000; // $15/MTok output
    const estCostUsd = inputTokens * PRICE_IN + outputTokens * PRICE_OUT;
    const durationMs = NOW() - job.startedAt;

    // Globaler Tracker
    if (!state.ccBudget) state.ccBudget = { totalTokensIn: 0, totalTokensOut: 0, totalCostUsd: 0, perTaskUsd: 2.0, jobs: [] };
    state.ccBudget.totalTokensIn += inputTokens;
    state.ccBudget.totalTokensOut += outputTokens;
    state.ccBudget.totalCostUsd += estCostUsd;
    state.ccBudget.jobs = [
      { projectId, taskId, ts: NOW(), inputTokens, outputTokens, costUsd: estCostUsd, durationMs, ok: code === 0 },
      ...(state.ccBudget.jobs || []),
    ].slice(0, 100);

    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "info",
      text: `tokens: ${inputTokens.toLocaleString("de")} in · ${outputTokens.toLocaleString("de")} out · ~$${estCostUsd.toFixed(4)} · ${(durationMs/1000).toFixed(1)}s`,
    }});

    // QUESTION-Block: claude hat rückfrage → in project.pendingQuestion speichern,
    // UI rendert sie als widget oberhalb des cc-prompts.
    const qm = fullOutput.match(/<<<QUESTION\s*([\s\S]*?)\s*>>>/);
    if (qm && qm[1].trim()) {
      const qText = qm[1].trim().slice(0, 1000);
      applyMutation("SET_PENDING_QUESTION", { projectId, question: qText });
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
      // Self-Review starten (async, blockiert nicht)
      runSelfReview(project, taskId, parsedStatus, fullOutput).then(review => {
        const taskNow = state.projects.find(p=>p.id===projectId)?.tasks.find(t=>t.id===taskId);
        if (!taskNow) return;
        if (review.ok) {
          // Alle offenen Sub-Tasks abhaken (vom TASK_PLAN erstellt)
          (taskNow.subtasks || []).filter(s => !s.done).forEach(s => {
            applyMutation("TOGGLE_SUBTASK", { projectId, taskId, subtaskId: s.id });
          });
          applyMutation("TOGGLE_TASK", { projectId, taskId });
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "check",
            text: `cc auto-checkmark: <i>${escapeHtml(taskNow.title)}</i>` +
                  (parsedStatus.summary ? ` · ${escapeHtml(parsedStatus.summary)}` : "") +
                  ` · review ok (${Math.round(review.confidence * 100)}%)`,
          }});
        } else {
          applyMutation("ADD_ACTIVITY", { projectId, event: {
            type: "warn",
            text: `cc self-review fand issues bei <i>${escapeHtml(taskNow.title)}</i>: ` +
                  review.issues.slice(0, 3).map(escapeHtml).join(" · "),
          }});
          applyMutation("ADD_SYNC_LOG", { entry: {
            source: "cloud", projectId,
            text: `cc self-review BLOCKIERT auto-checkmark (${review.issues.length} issue(s))`,
          }});
        }
        broadcastState();
      }).catch(e => {
        console.log("[selfreview] error:", e.message);
        // Bei Fehler: Task trotzdem mark done (fallback auf altes Verhalten)
        applyMutation("TOGGLE_TASK", { projectId, taskId });
        applyMutation("ADD_ACTIVITY", { projectId, event: {
          type: "check",
          text: `cc auto-checkmark (review skipped: ${escapeHtml(e.message)})`,
        }});
        broadcastState();
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
    ccJobs.delete(projectId);
    cleanupResolvedConfig(mcpConfigPath);
    console.error("[cc] proc error:", err.message);
    applyMutation("ADD_ACTIVITY", { projectId, event: {
      type: "warn",
      text: "cloud-code fehler: " + escapeHtml(err.message),
    }});
    broadcastState();
    broadcastForProject({ type: "CC_STATUS", projectId, status: { state: "idle" }, error: err.message }, projectId);
    emitPush({ type: "cc_error", projectId, error: err.message });
  });

  return { ok: true, projectId, startedAt: job.startedAt };
}

app.post("/api/cc/stop", authMw, (req, res) => {
  const { projectId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  const job = ccJobs.get(projectId);
  if (!job) return res.status(404).json({ error: "kein job läuft" });
  try { job.proc.kill("SIGTERM"); } catch (e) {}
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

// Vorschläge generieren: claude analysiert Projekt + schlägt 5-10 Improvements vor
app.post("/api/cc/suggest", authMw, async (req, res) => {
  const { projectId } = req.body || {};
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "projekt nicht gefunden" });
  if (!_requireProjectAccess(req, res, project, ROLES.MEMBER)) return;
  runSuggestionAnalysis(project).catch(e => console.log("[suggest] error:", e.message));
  res.json({ ok: true });
});

// ─── AI-Scaffold (neues projekt designen mit claude) ──────────
// Zwei modi:
//  · mode=improve    → claude verbessert/expandiert die rohbeschreibung
//  · mode=scaffold   → claude generiert goals/rules/tasks/files aus
//                       (verbessertem) beschreibungs-text.
// Kein projekt-bezug, läuft als ein-shot read-only claude-call.
function _spawnClaudeOneShot(prompt) {
  const cwd = process.cwd();
  const claudeBin = (function () {
    if (process.platform !== "win32") return "claude";
    const p = path.join(process.env.APPDATA || "", "npm", "claude.cmd");
    return fs.existsSync(p) ? p : "claude.cmd";
  })();
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
function publicState(session) {
  if (!session || !memberships) return state;
  return filterStateForSession(state, session, memberships);
}

// ─── Vorschläge + Bug-Hunt (claude-Analyse-Pässe) ──────────
function _spawnClaudeReadOnly(project, prompt) {
  const cwd = project.path && fs.existsSync(project.path) ? project.path : process.cwd();
  const claudeBin = (function () {
    if (process.platform !== "win32") return "claude";
    const p = path.join(process.env.APPDATA || "", "npm", "claude.cmd");
    return fs.existsSync(p) ? p : "claude.cmd";
  })();
  const mcpConfigPath = resolveMcpConfig({ baseDir: __dirname });
  const args = [
    "--print",
    "--permission-mode", "bypassPermissions",
    "--dangerously-skip-permissions",
    "--tools", "default",
    "--add-dir", cwd,
    "--max-budget-usd", "1.0",
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

async function runBugHunt(project) {
  const projectId = project.id;
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
  if (m) {
    try {
      const list = JSON.parse(m[1].trim());
      if (Array.isArray(list)) {
        for (const b of list.slice(0, 8)) {
          if (!b || !b.description) continue;
          applyMutation("ADD_BUG", { projectId, bug: {
            severity: ["low","medium","high"].includes(b.severity) ? b.severity : "medium",
            location: String(b.location || "").slice(0, 200),
            description: String(b.description).slice(0, 400),
            fix: String(b.fix || "").slice(0, 400),
            source: "cloud-code",
          }});
          count++;
        }
      }
    } catch (e) {}
  }
  applyMutation("ADD_ACTIVITY", { projectId, event: {
    type: count > 0 ? "warn" : "check",
    text: `bug-hunt fertig · ${count} bugs gefunden`,
  }});

  // Auto-Fix: wenn projekt.bugAutoFix ON → für jeden bug einen task anlegen + auto-pump nimmt sie auf
  const proj = state.projects.find(p => p.id === projectId);
  if (proj && proj.bugAutoFix) {
    const newBugs = (proj.bugs || []).filter(b => b.status === "pending").slice(0, count);
    for (const b of newBugs) {
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
    }
    if (newBugs.length) {
      applyMutation("ADD_ACTIVITY", { projectId, event: {
        type: "info",
        text: `auto-fix: ${newBugs.length} bug-tasks angelegt`,
      }});
    }
  }
  broadcastState();
}

// ─── Self-Review ────────────────────────────────────────────
// Zweiter claude-Pass: lässt den eigenen Output kritisch prüfen. Liefert
// {ok: bool, issues: string[], confidence: number}. Bei review-fail wird der
// task NICHT auto-checked. Default-Verhalten bei error: ok=true (fail-open).
async function runSelfReview(project, taskId, taskStatus, originalOutput) {
  const task = project.tasks.find(t => t.id === taskId);
  if (!task) return { ok: true, issues: [], confidence: 0.5 };

  const cwd = project.path && fs.existsSync(project.path) ? project.path : process.cwd();
  const claudeBin = (function () {
    if (process.platform !== "win32") return "claude";
    const p = path.join(process.env.APPDATA || "", "npm", "claude.cmd");
    return fs.existsSync(p) ? p : "claude.cmd";
  })();

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
        // ADD_PROJECT via WS: anlegenden user als owner setzen
        if (msg.mutation.type === "ADD_PROJECT" && liveSess.userId && memberships) {
          const created = state.projects[state.projects.length - 1];
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
function broadcastState() {
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    try {
      client.send(JSON.stringify({
        type: "STATE", state: publicState(client._session),
      }));
    } catch (_) {}
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
});
