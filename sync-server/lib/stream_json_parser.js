"use strict";
/**
 * lib/stream_json_parser.js
 * Parser für claude-cli `--output-format stream-json --verbose`-output.
 *
 * Claude-CLI emittiert ein event pro zeile (JSONL). Wichtige typen:
 *   { type: "system", subtype: "init", ... }       — session start
 *   { type: "system", subtype: "hook_*", ... }     — internal hooks (skip)
 *   { type: "assistant", message: { content: [...] } }
 *     content[i] = { type: "text", text: "..." }   ODER
 *                  { type: "tool_use", name: "Bash"|"Read"|..., input: {...} }
 *   { type: "user", ... }                          — tool-results
 *   { type: "rate_limit_event", ... }              — info, kein UI-event
 *   { type: "result", usage: {...}, total_cost_usd: ... }
 *
 * Pure-helper · keine I/O. parser hält line-buffer für split-chunks.
 */

const TOOL_GLYPHS = {
  Read: "👁",
  Edit: "✎",
  Write: "✎",
  MultiEdit: "✎",
  Bash: "$",
  PowerShell: "$",
  Glob: "🔍",
  Grep: "🔍",
  Task: "🪄",
  WebFetch: "🌐",
  WebSearch: "🌐",
  NotebookEdit: "📓",
  TodoWrite: "📋",
  Skill: "✦",
  ToolSearch: "🔍",
};

function _summarizeToolInput(name, input) {
  if (!input || typeof input !== "object") return "";
  switch (name) {
    case "Read":
      return (input.file_path || "").split(/[\\/]/).slice(-2).join("/");
    case "Edit":
    case "Write":
    case "MultiEdit":
      return (input.file_path || "").split(/[\\/]/).slice(-2).join("/");
    case "Bash":
    case "PowerShell":
      return String(input.command || input.description || "").slice(0, 80);
    case "Glob":
      return String(input.pattern || "").slice(0, 60);
    case "Grep":
      return String(input.pattern || "").slice(0, 50) +
        (input.glob ? " in " + input.glob : input.path ? " in " + input.path.split(/[\\/]/).slice(-1)[0] : "");
    case "WebFetch":
    case "WebSearch":
      return String(input.url || input.query || "").slice(0, 70);
    case "Task":
      return String(input.description || input.subagent_type || "").slice(0, 60);
    case "Skill":
      return String(input.skill || "").slice(0, 50);
    default:
      // generic: erste string-value im input
      for (const k of Object.keys(input)) {
        if (typeof input[k] === "string") return input[k].slice(0, 60);
      }
      return "";
  }
}

/**
 * Stateful line-buffer-parser für jsonl-stream.
 * Liefert .feed(chunk) → events[].
 * Jedes event hat eine `kind`:
 *   - "text"       : assistant text content    { text }
 *   - "tool_use"   : claude ruft tool auf      { tool, summary, glyph, id }
 *   - "tool_result": tool-resultat             { tool, isError, brief }
 *   - "init"       : session-start             { sessionId, cwd, mcpServers }
 *   - "result"     : finaler stand             { ok, costUsd, tokensIn, tokensOut, cacheCreated, cacheRead, durationMs }
 *   - "raw"        : unbekannter event-type    { type, data }
 */
function createStreamJsonParser() {
  let buf = "";
  // map tool-use-id → tool-name (für tool-result event)
  const toolUseLookup = new Map();

  function _handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let evt;
    try { evt = JSON.parse(trimmed); }
    catch (_) { return { kind: "raw", type: "parse-error", data: trimmed.slice(0, 200) }; }
    return _interpret(evt);
  }

  function _interpret(evt) {
    if (!evt || typeof evt !== "object") return null;
    const t = evt.type;
    if (t === "system") {
      if (evt.subtype === "init") {
        return {
          kind: "init",
          sessionId: evt.session_id,
          cwd: evt.cwd,
          mcpServers: (evt.mcp_servers || []).map(s => ({ name: s.name, status: s.status })),
        };
      }
      // hook_started/hook_response/etc. → noise, ignore
      return null;
    }
    if (t === "rate_limit_event") return null;
    if (t === "assistant" && evt.message && Array.isArray(evt.message.content)) {
      // assistant content kann mehrere blocks haben — wir liefern arrays
      const out = [];
      for (const c of evt.message.content) {
        if (!c || typeof c !== "object") continue;
        if (c.type === "text" && typeof c.text === "string") {
          out.push({ kind: "text", text: c.text });
        } else if (c.type === "tool_use") {
          const name = c.name || "?";
          const summary = _summarizeToolInput(name, c.input);
          toolUseLookup.set(c.id, name);
          out.push({
            kind: "tool_use",
            id: c.id,
            tool: name,
            glyph: TOOL_GLYPHS[name] || "•",
            summary,
          });
        } else if (c.type === "thinking" && typeof c.thinking === "string") {
          // Thinking-blocks zeigen wir als eigener event-typ (UI darf optional rendern)
          out.push({ kind: "thinking", text: c.thinking.slice(0, 400) });
        }
      }
      return out.length === 0 ? null : (out.length === 1 ? out[0] : { kind: "multi", events: out });
    }
    if (t === "user" && evt.message && Array.isArray(evt.message.content)) {
      // tool-results
      const out = [];
      for (const c of evt.message.content) {
        if (c && c.type === "tool_result") {
          const tool = toolUseLookup.get(c.tool_use_id) || "?";
          const isError = c.is_error === true;
          let brief = "";
          if (typeof c.content === "string") brief = c.content.slice(0, 80);
          else if (Array.isArray(c.content)) {
            const first = c.content.find(x => x && x.type === "text");
            if (first) brief = String(first.text || "").slice(0, 80);
          }
          out.push({ kind: "tool_result", id: c.tool_use_id, tool, isError, brief });
        }
      }
      return out.length === 0 ? null : (out.length === 1 ? out[0] : { kind: "multi", events: out });
    }
    if (t === "result") {
      const u = evt.usage || {};
      return {
        kind: "result",
        ok: evt.subtype === "success" && !evt.is_error,
        costUsd: typeof evt.total_cost_usd === "number" ? evt.total_cost_usd : null,
        tokensIn: u.input_tokens || 0,
        tokensOut: u.output_tokens || 0,
        cacheCreated: u.cache_creation_input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        durationMs: evt.duration_ms || null,
        numTurns: evt.num_turns || null,
      };
    }
    return { kind: "raw", type: t, data: null };
  }

  function feed(chunk) {
    buf += String(chunk);
    const events = [];
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const e = _handleLine(line);
      if (e === null) continue;
      if (e.kind === "multi") events.push(...e.events);
      else events.push(e);
    }
    return events;
  }

  function flush() {
    if (!buf.trim()) return [];
    const e = _handleLine(buf);
    buf = "";
    if (!e) return [];
    if (e.kind === "multi") return e.events;
    return [e];
  }

  return { feed, flush };
}

module.exports = { createStreamJsonParser, TOOL_GLYPHS };
