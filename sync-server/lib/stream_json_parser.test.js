"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createStreamJsonParser } = require("./stream_json_parser.js");

function L(obj) { return JSON.stringify(obj) + "\n"; }

test("init-event wird erkannt", () => {
  const p = createStreamJsonParser();
  const events = p.feed(L({
    type: "system", subtype: "init", session_id: "s1", cwd: "/x",
    mcp_servers: [{ name: "fs", status: "connected" }],
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "init");
  assert.equal(events[0].sessionId, "s1");
  assert.equal(events[0].mcpServers[0].name, "fs");
});

test("hook-events werden gefiltert (noise)", () => {
  const p = createStreamJsonParser();
  const events = p.feed(
    L({ type: "system", subtype: "hook_started", hook_id: "h1" }) +
    L({ type: "system", subtype: "hook_response", hook_id: "h1" }) +
    L({ type: "rate_limit_event", rate_limit_info: {} }),
  );
  assert.equal(events.length, 0);
});

test("assistant text content liefert text-event", () => {
  const p = createStreamJsonParser();
  const events = p.feed(L({
    type: "assistant", message: {
      content: [{ type: "text", text: "hallo welt" }],
    },
  }));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "text");
  assert.equal(events[0].text, "hallo welt");
});

test("tool_use mit Read liefert dateiname als summary", () => {
  const p = createStreamJsonParser();
  const events = p.feed(L({
    type: "assistant", message: {
      content: [{ type: "tool_use", id: "tu1", name: "Read",
        input: { file_path: "/repo/lib/foo/bar.js" } }],
    },
  }));
  assert.equal(events[0].kind, "tool_use");
  assert.equal(events[0].tool, "Read");
  assert.equal(events[0].summary, "foo/bar.js");
  assert.equal(events[0].glyph, "👁");
});

test("tool_use Bash zeigt command", () => {
  const p = createStreamJsonParser();
  const events = p.feed(L({
    type: "assistant", message: {
      content: [{ type: "tool_use", id: "tu2", name: "Bash",
        input: { command: "npm test --silent" } }],
    },
  }));
  assert.equal(events[0].tool, "Bash");
  assert.match(events[0].summary, /npm test/);
});

test("mehrere content-blocks → multi-events", () => {
  const p = createStreamJsonParser();
  const events = p.feed(L({
    type: "assistant", message: {
      content: [
        { type: "text", text: "denke nach" },
        { type: "tool_use", id: "tu3", name: "Glob", input: { pattern: "**/*.md" } },
      ],
    },
  }));
  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "text");
  assert.equal(events[1].kind, "tool_use");
});

test("tool_result findet tool-name aus vorherigem tool_use", () => {
  const p = createStreamJsonParser();
  p.feed(L({
    type: "assistant", message: { content: [
      { type: "tool_use", id: "tu99", name: "Bash", input: { command: "ls" } },
    ]},
  }));
  const events = p.feed(L({
    type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tu99", content: "file1\nfile2\n", is_error: false },
    ]},
  }));
  assert.equal(events[0].kind, "tool_result");
  assert.equal(events[0].tool, "Bash");
  assert.equal(events[0].isError, false);
  assert.match(events[0].brief, /file1/);
});

test("result-event mit echten zahlen", () => {
  const p = createStreamJsonParser();
  const events = p.feed(L({
    type: "result", subtype: "success", is_error: false,
    duration_ms: 2183, num_turns: 1, total_cost_usd: 0.22,
    usage: { input_tokens: 5, cache_creation_input_tokens: 35211, cache_read_input_tokens: 0, output_tokens: 6 },
  }));
  assert.equal(events[0].kind, "result");
  assert.equal(events[0].ok, true);
  assert.equal(events[0].costUsd, 0.22);
  assert.equal(events[0].tokensIn, 5);
  assert.equal(events[0].cacheCreated, 35211);
});

test("split chunk: half-line + rest = ein event", () => {
  const p = createStreamJsonParser();
  const json = L({ type: "assistant", message: { content: [{ type: "text", text: "split" }] } });
  const half = Math.floor(json.length / 2);
  let events = p.feed(json.slice(0, half));
  assert.equal(events.length, 0); // halbe zeile, noch kein newline
  events = p.feed(json.slice(half));
  assert.equal(events.length, 1);
  assert.equal(events[0].text, "split");
});

test("parse-error liefert raw-event statt crash", () => {
  const p = createStreamJsonParser();
  const events = p.feed("nicht-json\n");
  assert.equal(events[0].kind, "raw");
  assert.equal(events[0].type, "parse-error");
});

test("flush emittet letzte zeile ohne newline", () => {
  const p = createStreamJsonParser();
  p.feed('{"type":"assistant","message":{"content":[{"type":"text","text":"no-newline"}]}}');
  const events = p.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].text, "no-newline");
});
