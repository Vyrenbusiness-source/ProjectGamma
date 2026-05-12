"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveMcpConfig, cleanupResolvedConfig } = require("./mcp_resolver.js");

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-resolver-"));
  try { return fn(dir); } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

test("null wenn mcp.json fehlt", () => {
  withTempDir((dir) => {
    assert.equal(resolveMcpConfig({ baseDir: dir }), null);
  });
});

test("server mit fehlender env-var wird entfernt", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify({
      mcpServers: {
        ok: { command: "npx", args: ["-y", "x"] },
        broken: { command: "npx", args: ["-y", "y"], env: { KEY: "${MISSING_KEY_99}" } },
      },
    }));
    const env = { ...process.env };
    delete env.MISSING_KEY_99;
    const out = resolveMcpConfig({ baseDir: dir, env, tmpDir: dir });
    const resolved = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.ok(resolved.mcpServers.ok);
    assert.equal(resolved.mcpServers.broken, undefined);
    cleanupResolvedConfig(out);
  });
});

test("env-vars werden expandiert wenn gesetzt", () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, "mcp.json"), JSON.stringify({
      mcpServers: {
        s: { command: "x", args: [], env: { KEY: "${TEST_KEY_X}" } },
      },
    }));
    const out = resolveMcpConfig({
      baseDir: dir, env: { TEST_KEY_X: "secret" }, tmpDir: dir,
    });
    const resolved = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(resolved.mcpServers.s.env.KEY, "secret");
    cleanupResolvedConfig(out);
  });
});

test("cleanup ist idempotent", () => {
  cleanupResolvedConfig(null);
  cleanupResolvedConfig("/nonexistent/path/xyz");
  // kein throw → ok
});
