// Unit-tests für die 5 RUN3-fixes. Lädt server.js NICHT (zu viele
// side-effects), sondern repliziert die geänderten predicates lokal und
// prüft die invariants. Bei einer code-änderung in server.js müssen die
// snippets hier ggf. nachgezogen werden — das ist absichtlich, damit der
// test einen klaren contract gegen die predicates dokumentiert.

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { resolveMcpConfig } = require("../lib/mcp_resolver.js");

// ── Fix 1: selectModelForTask mit user-prompt statt fullPrompt ──────────
// Replikation der server.js-funktion (RO snippet, contract-test):
function selectModelForTask({ task, retryAttempt, prompt }) {
  if (retryAttempt && retryAttempt >= 2) return "claude-opus-4-7";
  if (!task) {
    if (prompt && prompt.length > 600) return "claude-opus-4-7";
    return "claude-sonnet-4-6";
  }
  return "claude-sonnet-4-6";
}

test("Fix 1: manual cc-run mit kurzem user-prompt → sonnet (nicht opus)", () => {
  // Bug: vorher wurde fullPrompt (~2500 zeichen) übergeben → immer opus.
  // Erwartung: jetzt user-prompt → kurz = sonnet.
  const userPrompt = "ERSTELLE RUN3.md mit nur dem Inhalt 'fertig'.";
  assert.equal(
    selectModelForTask({ task: null, retryAttempt: 0, prompt: userPrompt }),
    "claude-sonnet-4-6",
  );
});

test("Fix 1: langer user-prompt (>600 chars) immer noch opus", () => {
  const userPrompt = "x".repeat(700);
  assert.equal(
    selectModelForTask({ task: null, retryAttempt: 0, prompt: userPrompt }),
    "claude-opus-4-7",
  );
});

// ── Fix 2: isTrivialWriteTask checkt auch prompt-param ──────────────────
function isTrivialWriteTask({ task, prompt }) {
  const _descShort = (task?.description || "").trim();
  const _titleLower = (task?.title || "").toLowerCase();
  const _trivialBlob = task ? (_descShort + " " + _titleLower)
                            : (typeof prompt === "string" ? prompt.trim() : "");
  return _trivialBlob.length > 0 &&
    _trivialBlob.length < 300 &&
    /^\s*(erstelle|schreibe|lege an|create|write|f[uü]ge|add)\b/i.test(_trivialBlob);
}

test("Fix 2: freier prompt mit 'Erstelle…' → isTrivialWriteTask=true", () => {
  assert.equal(
    isTrivialWriteTask({ task: null, prompt: "Erstelle RUN3.md mit 'fertig'" }),
    true,
  );
});

test("Fix 2: freier prompt ohne write-verb → isTrivialWriteTask=false", () => {
  assert.equal(
    isTrivialWriteTask({ task: null, prompt: "Refaktoriere die auth-middleware" }),
    false,
  );
});

test("Fix 2: task-mode bleibt unverändert", () => {
  assert.equal(
    isTrivialWriteTask({
      task: { title: "Erstelle X.md", description: "" },
      prompt: undefined,
    }),
    true,
  );
});

test("Fix 2: weder task noch prompt → false (kein false-positive auf leer)", () => {
  assert.equal(isTrivialWriteTask({ task: null, prompt: undefined }), false);
  assert.equal(isTrivialWriteTask({ task: null, prompt: "" }), false);
});

// ── Fix 3: Guardrail-Text nennt Synonyme ────────────────────────────────
test("Fix 3: server.js-prompt enthält Invoke-RestMethod/wget/iwr-tokens", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(src, /Invoke-RestMethod/);
  assert.match(src, /\biwr\b/);
  assert.match(src, /\bwget\b/);
  assert.match(src, /Invoke-WebRequest/);
});

// ── Fix 4: PreToolUse-hook script existiert + smoketest ─────────────────
test("Fix 4: block-localhost.js hook existiert", () => {
  const hookPath = path.join(__dirname, "..", "..", ".claude", "hooks", "block-localhost.js");
  assert.ok(fs.existsSync(hookPath), "hook script muss existieren: " + hookPath);
  const settings = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "..", ".claude", "settings.json"), "utf8"));
  const matchers = (settings.hooks?.PreToolUse || []).map(h => h.matcher);
  assert.ok(matchers.includes("Bash"), "PreToolUse hook für Bash muss konfiguriert sein");
});

// ── Fix 5: fetch-MCP aus full-Tier raus (MCP_BLOCK) ─────────────────────
test("Fix 5: fetch wird auch im full-tier nicht aufgenommen", () => {
  const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "mcp-test-"));
  try {
    const configPath = resolveMcpConfig({
      baseDir: path.join(__dirname, ".."),
      tier: "full",
      tmpDir,
    });
    assert.ok(configPath, "config-pfad muss zurückkommen");
    const resolved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const serverNames = Object.keys(resolved.mcpServers || {});
    assert.ok(serverNames.includes("filesystem"),
      "filesystem muss im full-tier sein, ist: " + JSON.stringify(serverNames));
    assert.ok(!serverNames.includes("fetch"),
      "fetch DARF NICHT im full-tier sein, ist aber: " + JSON.stringify(serverNames));
    fs.unlinkSync(configPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Fix 5: fetch auch in standard-tier nicht (war eh nicht drin, regression-guard)", () => {
  const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "mcp-test-"));
  try {
    const configPath = resolveMcpConfig({
      baseDir: path.join(__dirname, ".."),
      tier: "standard",
      tmpDir,
    });
    const resolved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const serverNames = Object.keys(resolved.mcpServers || {});
    assert.ok(!serverNames.includes("fetch"));
    fs.unlinkSync(configPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
