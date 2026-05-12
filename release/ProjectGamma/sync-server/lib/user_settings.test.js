"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createUserSettingsStore, KNOWN_KEYS } = require("./user_settings.js");

function tmp() {
  return path.join(os.tmpdir(), "us_test_" + Math.random().toString(36).slice(2));
}

test("getAllMasked liefert 'unset' wenn file nicht existiert", () => {
  const f = tmp();
  const s = createUserSettingsStore({ file: f });
  const out = s.getAllMasked();
  for (const k of KNOWN_KEYS) assert.equal(out[k], "unset");
});

test("setKey persistiert + getAllMasked maskiert", () => {
  const f = tmp();
  const s = createUserSettingsStore({ file: f });
  s.setKey("ANTHROPIC_API_KEY", "sk-ant-1234567890ABCD");
  const out = s.getAllMasked();
  assert.match(out.ANTHROPIC_API_KEY, /^set \(/);
  assert.match(out.ANTHROPIC_API_KEY, /ABCD\)/); // last 4
  fs.unlinkSync(f);
});

test("getRaw liefert klartext + envOverlay nur gesetzte", () => {
  const f = tmp();
  const s = createUserSettingsStore({ file: f });
  s.setKey("REF_API_KEY", "ref-xyz");
  assert.equal(s.getRaw("REF_API_KEY"), "ref-xyz");
  assert.equal(s.getRaw("ANTHROPIC_API_KEY"), null);
  assert.deepEqual(s.envOverlay(), { REF_API_KEY: "ref-xyz" });
  fs.unlinkSync(f);
});

test("setKey mit leerwert löscht entry", () => {
  const f = tmp();
  const s = createUserSettingsStore({ file: f });
  s.setKey("REF_API_KEY", "x");
  s.setKey("REF_API_KEY", "");
  assert.equal(s.getRaw("REF_API_KEY"), null);
  fs.unlinkSync(f);
});

test("setKey wirft bei unbekanntem key", () => {
  const f = tmp();
  const s = createUserSettingsStore({ file: f });
  assert.throws(() => s.setKey("HACKER_KEY", "x"));
});

test("setKey wirft bei nicht-string value", () => {
  const f = tmp();
  const s = createUserSettingsStore({ file: f });
  assert.throws(() => s.setKey("REF_API_KEY", 12345));
});

test("kurze keys werden auch maskiert", () => {
  const f = tmp();
  const s = createUserSettingsStore({ file: f });
  s.setKey("REF_API_KEY", "abc");
  assert.equal(s.getAllMasked().REF_API_KEY, "set (***)");
  fs.unlinkSync(f);
});
