"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword } = require("./password_hash.js");

test("hash + verify round-trip", () => {
  const h = hashPassword("correcthorsebatterystaple");
  assert.equal(verifyPassword("correcthorsebatterystaple", h), true);
});

test("verify lehnt falsches passwort ab", () => {
  const h = hashPassword("passwort123");
  assert.equal(verifyPassword("passwort1234", h), false);
  assert.equal(verifyPassword("", h), false);
});

test("hashPassword wirft bei zu kurzem passwort", () => {
  assert.throws(() => hashPassword("kurz"));
  assert.throws(() => hashPassword(""));
});

test("hashPassword wirft bei nicht-string", () => {
  assert.throws(() => hashPassword(null));
  assert.throws(() => hashPassword(undefined));
  assert.throws(() => hashPassword(12345678));
});

test("zwei hashes desselben passworts unterscheiden sich (salt)", () => {
  const a = hashPassword("supergeheim");
  const b = hashPassword("supergeheim");
  assert.notEqual(a, b);
  assert.equal(verifyPassword("supergeheim", a), true);
  assert.equal(verifyPassword("supergeheim", b), true);
});

test("verifyPassword lehnt mangelhaften hash-string ab", () => {
  assert.equal(verifyPassword("x", ""), false);
  assert.equal(verifyPassword("x", "nicht-ein-hash"), false);
  assert.equal(verifyPassword("x", "bcrypt$10$..."), false);
});

test("verifyPassword lehnt nicht-string-input ab", () => {
  assert.equal(verifyPassword(null, "scrypt$..."), false);
  assert.equal(verifyPassword("x", null), false);
});
