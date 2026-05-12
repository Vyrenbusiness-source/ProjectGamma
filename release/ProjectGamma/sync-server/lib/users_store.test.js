"use strict";
/**
 * lib/users_store.test.js
 * node:test fuer users_store (multi-user schicht 1: identitaet + session).
 * Laeuft gegen :memory: sqlite, keine fs-effekte.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createUsersStore } = require("./users_store");

function freshDb() {
  return new DatabaseSync(":memory:");
}

test("registerUser: legt user mit id, email, createdAt an", () => {
  const store = createUsersStore({ db: freshDb() });
  const u = store.registerUser({ email: "a@b.de", passwordHash: "h" });
  assert.equal(typeof u.id, "string");
  assert.equal(u.email, "a@b.de");
  assert.equal(typeof u.createdAt, "number");
});

test("registerUser: lehnt duplikat-email ab", () => {
  const store = createUsersStore({ db: freshDb() });
  store.registerUser({ email: "x@y.de", passwordHash: "h" });
  assert.throws(
    () => store.registerUser({ email: "x@y.de", passwordHash: "h2" }),
    /exists/i
  );
});

test("registerUser: pflicht-felder werden geprueft", () => {
  const store = createUsersStore({ db: freshDb() });
  assert.throws(() => store.registerUser({ email: "", passwordHash: "h" }), /email/);
  assert.throws(() => store.registerUser({ email: "a@b.de", passwordHash: "" }), /password/);
});

test("findUserByEmail/Id liefern user, null bei miss", () => {
  const store = createUsersStore({ db: freshDb() });
  const u = store.registerUser({ email: "c@d.de", passwordHash: "h" });
  assert.equal(store.findUserByEmail("c@d.de").id, u.id);
  assert.equal(store.findUserById(u.id).email, "c@d.de");
  assert.equal(store.findUserByEmail("nope@x.de"), null);
  assert.equal(store.findUserById("missing"), null);
});

test("createSession: liefert token + expiresAt > now", () => {
  const store = createUsersStore({ db: freshDb() });
  const u = store.registerUser({ email: "s@s.de", passwordHash: "h" });
  const s = store.createSession({ userId: u.id, ttlMs: 60_000 });
  assert.equal(typeof s.token, "string");
  assert.ok(s.token.length >= 16);
  assert.ok(s.expiresAt > Date.now());
});

test("createSession: lehnt unbekannten user ab", () => {
  const store = createUsersStore({ db: freshDb() });
  assert.throws(
    () => store.createSession({ userId: "ghost", ttlMs: 1000 }),
    /user/i
  );
});

test("resolveSession: findet aktive session, ignoriert abgelaufene", () => {
  const store = createUsersStore({ db: freshDb() });
  const u = store.registerUser({ email: "r@r.de", passwordHash: "h" });
  const s = store.createSession({ userId: u.id, ttlMs: 60_000 });
  const live = store.resolveSession(s.token);
  assert.equal(live.userId, u.id);

  const dead = store.createSession({ userId: u.id, ttlMs: -1 });
  assert.equal(store.resolveSession(dead.token), null);
  assert.equal(store.resolveSession("garbage"), null);
});

test("revokeSession: entfernt token sofort", () => {
  const store = createUsersStore({ db: freshDb() });
  const u = store.registerUser({ email: "v@v.de", passwordHash: "h" });
  const s = store.createSession({ userId: u.id, ttlMs: 60_000 });
  store.revokeSession(s.token);
  assert.equal(store.resolveSession(s.token), null);
});

test("purgeExpired: loescht nur abgelaufene", () => {
  const store = createUsersStore({ db: freshDb() });
  const u = store.registerUser({ email: "p@p.de", passwordHash: "h" });
  const live = store.createSession({ userId: u.id, ttlMs: 60_000 });
  const dead = store.createSession({ userId: u.id, ttlMs: -1 });
  const removed = store.purgeExpired(Date.now());
  assert.equal(removed, 1);
  assert.ok(store.resolveSession(live.token));
  assert.equal(store.resolveSession(dead.token), null);
});
