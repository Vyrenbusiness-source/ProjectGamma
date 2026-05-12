"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveLiveSession } = require("./ws_session_guard");

test("liefert aktuelle session wenn token noch in map vorhanden", () => {
  const sess = { deviceName: "phone-1" };
  const sessions = new Map([["tok-a", sess]]);
  assert.equal(resolveLiveSession(sessions, "tok-a"), sess);
});

test("liefert null nach sessions.delete (revoked) – kein cache-bypass", () => {
  const sessions = new Map([["tok-a", { deviceName: "phone" }]]);
  sessions.delete("tok-a");
  assert.equal(resolveLiveSession(sessions, "tok-a"), null);
});

test("liefert null bei fehlendem token oder leerer map", () => {
  assert.equal(resolveLiveSession(new Map(), "tok-a"), null);
  assert.equal(resolveLiveSession(new Map([["x", {}]]), undefined), null);
  assert.equal(resolveLiveSession(new Map([["x", {}]]), ""), null);
});
