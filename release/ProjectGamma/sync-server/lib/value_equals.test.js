"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { valueEquals } = require("./value_equals");

test("primitive gleich/ungleich", () => {
  assert.equal(valueEquals(1, 1), true);
  assert.equal(valueEquals("a", "a"), true);
  assert.equal(valueEquals(1, 2), false);
  assert.equal(valueEquals(null, null), true);
  assert.equal(valueEquals(null, undefined), false);
});

test("NaN ist gleich NaN (Object.is-fall)", () => {
  assert.equal(valueEquals(NaN, NaN), true);
});

test("strukturgleiche arrays — verschiedene referenzen — sind gleich", () => {
  assert.equal(valueEquals(["a", "b"], ["a", "b"]), true);
});

test("arrays mit unterschiedlicher länge/inhalt sind ungleich", () => {
  assert.equal(valueEquals(["a"], ["a", "b"]), false);
  assert.equal(valueEquals(["a", "b"], ["a", "c"]), false);
});

test("strukturgleiche objekte sind gleich", () => {
  assert.equal(valueEquals({ x: 1, y: [2, 3] }, { x: 1, y: [2, 3] }), true);
});

test("objekte mit anderen keys/values sind ungleich", () => {
  assert.equal(valueEquals({ x: 1 }, { x: 1, y: 2 }), false);
  assert.equal(valueEquals({ x: 1 }, { x: 2 }), false);
});

test("objekt vs array ist ungleich auch bei gleicher key-anzahl", () => {
  assert.equal(valueEquals([], {}), false);
});
