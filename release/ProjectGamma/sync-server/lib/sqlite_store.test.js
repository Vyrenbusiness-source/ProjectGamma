"use strict";
// Tests fuer lib/sqlite_store.js (TDD-first).
// Verwendet node:sqlite (Node >= 22.5, --experimental-sqlite ggf. noetig).

const test = require("node:test");
const assert = require("node:assert/strict");

let createSqliteStore;
let sqliteAvailable = true;
try {
  ({ createSqliteStore } = require("./sqlite_store"));
  // probe node:sqlite verfuegbarkeit
  require("node:sqlite");
} catch (e) {
  sqliteAvailable = false;
}

const skip = !sqliteAvailable;

test("loadState liefert defaults bei leerer DB", { skip }, () => {
  const store = createSqliteStore({ filename: ":memory:" });
  const state = store.loadState({ projects: [] });
  assert.deepEqual(state, { projects: [] });
  store.close();
});

test("saveState + loadState round-trip", { skip }, () => {
  const store = createSqliteStore({ filename: ":memory:" });
  const data = { projects: [{ id: "a", name: "A" }], n: 1 };
  store.saveState(data);
  const out = store.loadState({ projects: [] });
  assert.deepEqual(out, data);
  store.close();
});

test("transaction(fn) committed atomar", { skip }, () => {
  const store = createSqliteStore({ filename: ":memory:" });
  store.saveState({ v: 0 });
  store.transaction(() => {
    store.saveState({ v: 1 });
    store.saveState({ v: 2 });
  });
  assert.deepEqual(store.loadState({}), { v: 2 });
  store.close();
});

test("transaction(fn) rollback bei throw", { skip }, () => {
  const store = createSqliteStore({ filename: ":memory:" });
  store.saveState({ v: "before" });
  assert.throws(() =>
    store.transaction(() => {
      store.saveState({ v: "during" });
      throw new Error("boom");
    })
  );
  assert.deepEqual(store.loadState({}), { v: "before" });
  store.close();
});

test("migrateFromJson uebernimmt blob nur einmal", { skip }, () => {
  const store = createSqliteStore({ filename: ":memory:" });
  const json = { projects: [{ id: "x" }] };
  const m1 = store.migrateFromJson(json);
  assert.equal(m1, true);
  const m2 = store.migrateFromJson({ projects: [] });
  assert.equal(m2, false, "zweite Migration darf nicht ueberschreiben");
  assert.deepEqual(store.loadState({}), json);
  store.close();
});
