#!/usr/bin/env node
// PreToolUse-hook für Bash: blockiert HTTP-requests an localhost/127.0.0.1/::1.
//
// Kontext: cc-jobs vom sync-server haben tendenz, sich via
// `Invoke-RestMethod http://localhost:7892/api/state` selbst-introspektion
// zu betreiben statt der aufgabe zu folgen (siehe FOKUS-GUARDRAIL im
// server.js-prompt). der prompt-text ist soft, dieser hook ist hard.
//
// Protokoll: stdin = JSON { tool_name, tool_input: { command } }.
// exit 0 + leeres stdout → allow.
// exit 2 + stderr-text → block mit reason.
//
// Erlaubt-liste (für legitime fälle): kein eintrag aktuell. wenn die
// aufgabe wirklich ein page-test ist, muss der prompt-text das durchsetzen
// und der hook ggf. via env-var (CC_ALLOW_LOCALHOST=1) deaktiviert werden.

"use strict";

const LOCALHOST_RX =
  /\b(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)(?::\d+)?(?:\/[^\s'"`]*)?/i;

// Häufige HTTP-client-tokens — falls jemand `localhost` in einem unrelated
// pfad nennt (z.b. `grep localhost ./logs`), wollen wir nicht blocken.
// Nur wenn EIN HTTP-tool im command vorkommt + localhost-host: hart block.
const HTTP_TOOL_RX =
  /\b(curl|wget|Invoke-RestMethod|iwr|Invoke-WebRequest|http\.(get|post|request)|requests\.(get|post)|fetch\s*\(|axios|httpie)\b/i;

function read(stream) {
  return new Promise((resolve) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => { buf += c; });
    stream.on("end", () => resolve(buf));
    stream.on("error", () => resolve(buf));
  });
}

(async () => {
  if (process.env.CC_ALLOW_LOCALHOST === "1") process.exit(0);

  const raw = await read(process.stdin);
  let payload;
  try { payload = JSON.parse(raw || "{}"); } catch (_) { process.exit(0); }

  const toolName = payload.tool_name || payload.toolName || "";
  if (toolName !== "Bash") process.exit(0);

  const cmd = String(payload.tool_input?.command || payload.toolInput?.command || "");
  if (!cmd) process.exit(0);

  const hasLocalhost = LOCALHOST_RX.test(cmd);
  const hasHttpTool = HTTP_TOOL_RX.test(cmd);
  if (!hasLocalhost || !hasHttpTool) process.exit(0);

  process.stderr.write(
    "BLOCKED by .claude/hooks/block-localhost.js — der Bash-call zielt auf " +
    "localhost/127.0.0.1/::1 mit einem HTTP-tool. das ist per FOKUS-GUARDRAIL " +
    "verboten. der sync-server ist NICHT dein context-store — lies state via " +
    "Read/Glob/Grep direkt aus dem repo. falls die aufgabe wirklich einen " +
    "lokalen HTTP-call braucht, setze CC_ALLOW_LOCALHOST=1 im env."
  );
  process.exit(2);
})();
