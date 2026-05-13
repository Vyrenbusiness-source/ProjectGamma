"use strict";
/**
 * Tests für lib/process_kill.js
 * Plattform-pfade werden via opts._platform / opts._spawnSync injected,
 * damit beide branches (windows/posix) auf jeder CI laufen.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { killTreeSync, killTreeGraceful } = require("./process_kill");

function fakeChild({ pid = 1234, killed = false, killImpl } = {}) {
  const log = [];
  return {
    pid,
    killed,
    kill(sig) {
      log.push(sig);
      if (killImpl) return killImpl(sig);
      return true;
    },
    _log: log,
  };
}

test("killTreeSync: null/leerer child → false, kein throw", () => {
  assert.equal(killTreeSync(null), false);
  assert.equal(killTreeSync(undefined), false);
  assert.equal(killTreeSync({ killed: true, pid: 1 }), false);
});

test("killTreeSync: posix → child.kill(SIGTERM) default", () => {
  const c = fakeChild();
  const ok = killTreeSync(c, { _platform: "linux" });
  assert.equal(ok, true);
  assert.deepEqual(c._log, ["SIGTERM"]);
});

test("killTreeSync: posix mit custom signal", () => {
  const c = fakeChild();
  killTreeSync(c, { _platform: "linux", signal: "SIGKILL" });
  assert.deepEqual(c._log, ["SIGKILL"]);
});

test("killTreeSync: windows → taskkill /pid /T /F mit korrekten args", () => {
  const c = fakeChild({ pid: 4242 });
  const calls = [];
  const spawn_ = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: 0 };
  };
  const ok = killTreeSync(c, { _platform: "win32", _spawnSync: spawn_ });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "taskkill");
  assert.deepEqual(calls[0].args, ["/pid", "4242", "/T", "/F"]);
  assert.equal(calls[0].opts.windowsHide, true);
  assert.equal(calls[0].opts.stdio, "ignore");
  // child.kill darf NICHT zusätzlich gerufen werden — würde cmd.exe killen
  // bevor taskkill den baum traversieren konnte.
  assert.deepEqual(c._log, []);
});

test("killTreeSync: windows + taskkill exit-code 128 (not found) gilt als ok", () => {
  const c = fakeChild({ pid: 9999 });
  const spawn_ = () => ({ status: 128 });
  const ok = killTreeSync(c, { _platform: "win32", _spawnSync: spawn_ });
  assert.equal(ok, true);
  assert.deepEqual(c._log, []);
});

test("killTreeSync: windows + taskkill fehler → fallback child.kill", () => {
  const c = fakeChild({ pid: 1 });
  const spawn_ = () => { throw new Error("taskkill nicht vorhanden"); };
  const ok = killTreeSync(c, { _platform: "win32", _spawnSync: spawn_ });
  assert.equal(ok, true);
  assert.deepEqual(c._log, ["SIGTERM"]);
});

test("killTreeSync: windows + taskkill exit-status !=0/128 → fallback", () => {
  const c = fakeChild({ pid: 1 });
  const spawn_ = () => ({ status: 1 });
  killTreeSync(c, { _platform: "win32", _spawnSync: spawn_ });
  assert.deepEqual(c._log, ["SIGTERM"]);
});

test("killTreeGraceful: posix → SIGTERM sofort, SIGKILL nach gracefulMs", () => {
  const c = fakeChild();
  let scheduled = null;
  const fakeTimer = (fn, ms) => { scheduled = { fn, ms }; return 0; };
  killTreeGraceful(c, { _platform: "linux", gracefulMs: 1234, _setTimeout: fakeTimer });
  assert.deepEqual(c._log, ["SIGTERM"]);
  assert.equal(scheduled.ms, 1234);
  scheduled.fn();
  assert.deepEqual(c._log, ["SIGTERM", "SIGKILL"]);
});

test("killTreeGraceful: posix + child wird vor timer killed → kein SIGKILL", () => {
  const c = fakeChild();
  let scheduled = null;
  const fakeTimer = (fn) => { scheduled = fn; return 0; };
  killTreeGraceful(c, { _platform: "linux", _setTimeout: fakeTimer });
  c.killed = true;
  scheduled();
  assert.deepEqual(c._log, ["SIGTERM"]);
});

test("killTreeGraceful: windows → taskkill, kein doppel-kill", () => {
  const c = fakeChild({ pid: 77 });
  const calls = [];
  const spawn_ = (cmd, args) => { calls.push({ cmd, args }); return { status: 0 }; };
  killTreeGraceful(c, { _platform: "win32", _spawnSync: spawn_ });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["/pid", "77", "/T", "/F"]);
  assert.deepEqual(c._log, []);
});

test("integration: echter spawn-child wird durch killTreeSync beendet", { timeout: 5000 }, async () => {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "node" : "node";
  const args = ["-e", "setInterval(()=>{}, 1000)"];
  const child = spawn(cmd, args, { windowsHide: true, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 100));
  const ok = killTreeSync(child);
  assert.equal(ok, true);
  await new Promise((resolve) => child.once("exit", resolve));
  // exit-code variiert je platform; wichtig ist nur DASS das kind beendet wurde
  assert.equal(child.killed || child.exitCode !== null || child.signalCode !== null, true);
});
