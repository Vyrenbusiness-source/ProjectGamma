"use strict";
/**
 * lib/password_hash.js
 * Multi-user schicht 1: passwort-hashing via node:crypto scrypt.
 *
 * Kein npm-dep nötig — node-eingebautes scrypt mit zufälligem salt.
 * Format des hash-strings: "scrypt$N$r$p$<saltBase64>$<keyBase64>"
 *
 * Pure-modul → testbar via node:test ohne fs/db.
 */

const crypto = require("node:crypto");

// scrypt-parameter — N (cost) ist die bestimmende grösse, 2^15 ≈ 100ms auf
// modernem desktop. Bewusst konservativ, kann beim user-flow erhöht werden.
const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32; // 256 bit
const SALT_LEN = 16; // 128 bit

function hashPassword(password) {
  if (!password || typeof password !== "string") {
    throw new Error("hashPassword: 'password' (string) erforderlich");
  }
  if (password.length < 8) {
    throw new Error("hashPassword: password muss mind. 8 zeichen lang sein");
  }
  const salt = crypto.randomBytes(SALT_LEN);
  const key = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt", String(SCRYPT_N), String(SCRYPT_R), String(SCRYPT_P),
    salt.toString("base64"), key.toString("base64"),
  ].join("$");
}

function verifyPassword(password, hash) {
  if (typeof password !== "string" || typeof hash !== "string") return false;
  const parts = hash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch (_) { return false; }
  if (expected.length !== KEY_LEN) return false;
  let actual;
  try {
    actual = crypto.scryptSync(password, salt, KEY_LEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  } catch (_) { return false; }
  // timing-safe vergleich gegen brute-force
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
