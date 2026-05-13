// Resolved MCP-Konfig für Claude-Code-Spawns.
//
// Liest mcp.json und entfernt Server-Einträge, deren env-vars im aktuellen
// Prozess nicht gesetzt sind (z.B. REF_API_KEY → ref-tools). Sonst startet
// claude den Server, der antwortet aber nicht und blockiert tool-calls.
//
// Schreibt das Ergebnis in eine eindeutige temp-Datei im sync-server/-ordner,
// damit der bestehende --mcp-config-Pfad-Flow unverändert bleibt.

"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VAR_RX = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;

function expandEnv(value, env) {
  if (typeof value !== "string") return value;
  const m = VAR_RX.exec(value);
  if (!m) return value;
  return env[m[1]] || "";
}

// MCP-tier-allowlists: kleine tasks brauchen meistens nur filesystem +
// sequential-thinking. puppeteer/code-runner/context7/fetch/github sind
// schwergewicht (lange cold-start + große tool-schemas im prompt = mehr
// tokens). Tiers spart pro spawn 6-8 server × 1-2s startup + ~7000
// schema-tokens.
const MCP_TIERS = {
  minimal: new Set(["filesystem", "sequential-thinking", "memory"]),
  // standard fügt context7 (lib-docs) hinzu — viele tasks brauchen das
  standard: new Set(["filesystem", "sequential-thinking", "memory", "context7"]),
  // full = alles aus mcp.json, modulo MCP_BLOCK
  full: null,
};

// Hard-Blocklist: server die NIE aktiviert werden, egal welcher tier.
// fetch wurde gestrichen weil das modell darüber localhost:7892/api/state
// abfragen kann (sync-server-introspection statt task-fokus). für externe
// HTTP-fetches reicht Bash mit curl — auf das wird per FOKUS-GUARDRAIL und
// pretooluse-hook geprüft.
const MCP_BLOCK = new Set(["fetch"]);

/**
 * Lädt mcp.json, filtert tote server (env-vars fehlen) und schreibt eine
 * resolved-config in eine temp-datei. Liefert deren Pfad zurück, oder null
 * falls keine config existiert.
 *
 * tier: "minimal" | "standard" | "full" (default "full" = legacy verhalten)
 */
function resolveMcpConfig({ baseDir, env = process.env, tmpDir, tier = "full" }) {
  const sourcePath = path.join(baseDir, "mcp.json");
  if (!fs.existsSync(sourcePath)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (e) {
    console.warn("[mcp] mcp.json invalid:", e && e.message);
    return null;
  }
  const allow = MCP_TIERS[tier] || null;
  const servers = (raw && raw.mcpServers) || {};
  const out = {};
  for (const [name, def] of Object.entries(servers)) {
    if (!def || typeof def !== "object") continue;
    if (MCP_BLOCK.has(name)) continue; // hard-block, tier-unabhängig
    if (allow && !allow.has(name)) continue; // tier-filter
    const envIn = def.env || {};
    let skip = false;
    const envOut = {};
    for (const [k, v] of Object.entries(envIn)) {
      const expanded = expandEnv(v, env);
      if (typeof v === "string" && VAR_RX.test(v) && !expanded) {
        console.warn(`[mcp] server "${name}" deaktiviert — env-var fehlt: ${v}`);
        skip = true;
        break;
      }
      envOut[k] = expanded;
    }
    if (skip) continue;
    const cleaned = { command: def.command, args: def.args };
    if (Object.keys(envOut).length) cleaned.env = envOut;
    if (def.cwd) cleaned.cwd = def.cwd;
    out[name] = cleaned;
  }
  const dir = tmpDir || baseDir;
  const tmpPath = path.join(dir, `.mcp.resolved.${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify({ mcpServers: out }, null, 2));
  return tmpPath;
}

/** Löscht eine zuvor erzeugte resolved-config. Idempotent. */
function cleanupResolvedConfig(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) { /* schon weg */ }
}

module.exports = { resolveMcpConfig, cleanupResolvedConfig };
