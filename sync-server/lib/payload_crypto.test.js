const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveProjectKey,
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
} = require("./payload_crypto");

const SECRET = "test-project-secret-32-bytes-long!";
const SALT = "projectgamma-v1";

test("deriveProjectKey ist deterministisch und 32 byte lang", () => {
  const k1 = deriveProjectKey(SECRET, SALT);
  const k2 = deriveProjectKey(SECRET, SALT);
  assert.equal(k1.length, 32);
  assert.deepEqual(k1, k2);
});

test("deriveProjectKey unterscheidet sich bei abweichendem salt", () => {
  const k1 = deriveProjectKey(SECRET, SALT);
  const k2 = deriveProjectKey(SECRET, SALT + "x");
  assert.notDeepEqual(k1, k2);
});

test("encrypt/decrypt round-trip stellt obj wieder her", () => {
  const key = deriveProjectKey(SECRET, SALT);
  const payload = { type: "ADD_TASK", text: "umlaute äöü", n: 42 };
  const env = encryptPayload(key, payload);
  assert.equal(isEncryptedEnvelope(env), true);
  const back = decryptPayload(key, env);
  assert.deepEqual(back, payload);
});

test("decrypt mit falschem key wirft", () => {
  const k1 = deriveProjectKey(SECRET, SALT);
  const k2 = deriveProjectKey(SECRET + "x", SALT);
  const env = encryptPayload(k1, { x: 1 });
  assert.throws(() => decryptPayload(k2, env));
});

test("manipuliertes ciphertext wirft (auth-tag-check)", () => {
  const key = deriveProjectKey(SECRET, SALT);
  const env = encryptPayload(key, { x: 1 });
  const raw = Buffer.from(env.ct, "base64");
  raw[0] ^= 0xff;
  const tampered = { ...env, ct: raw.toString("base64") };
  assert.throws(() => decryptPayload(key, tampered));
});

test("isEncryptedEnvelope false fuer nicht-envelope-werte", () => {
  assert.equal(isEncryptedEnvelope(null), false);
  assert.equal(isEncryptedEnvelope({ type: "X" }), false);
  assert.equal(isEncryptedEnvelope({ v: 1, iv: "a", ct: "b", tag: "c" }), true);
});

test("jede verschluesselung erzeugt unique iv (keine nonce-reuse)", () => {
  const key = deriveProjectKey(SECRET, SALT);
  const ivs = new Set();
  for (let i = 0; i < 50; i++) ivs.add(encryptPayload(key, { i }).iv);
  assert.equal(ivs.size, 50);
});
