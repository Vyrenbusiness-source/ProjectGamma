const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("./conflict_diff");

test("splitLines: leerer/null input → []", () => {
  assert.deepEqual(D.splitLines(""), []);
  assert.deepEqual(D.splitLines(null), []);
});

test("splitLines: mehrzeilig, \\r\\n und \\n", () => {
  assert.deepEqual(D.splitLines("a\nb\nc"), ["a", "b", "c"]);
  assert.deepEqual(D.splitLines("a\r\nb"), ["a", "b"]);
});

test("computeSideBySide: identische strings → alle 'equal'", () => {
  const rows = D.computeSideBySide("a\nb", "a\nb");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.kind === "equal"));
});

test("computeSideBySide: einzeilige änderung → 'change'", () => {
  const rows = D.computeSideBySide("A", "B");
  assert.deepEqual(rows, [{ kind: "change", left: "A", right: "B" }]);
});

test("computeSideBySide: zeile nur lokal → 'remove'", () => {
  const rows = D.computeSideBySide("a\nb", "a");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "equal");
  assert.equal(rows[1].kind, "remove");
  assert.equal(rows[1].left, "b");
  assert.equal(rows[1].right, null);
});

test("computeSideBySide: zeile nur remote → 'add'", () => {
  const rows = D.computeSideBySide("a", "a\nb");
  assert.equal(rows[1].kind, "add");
  assert.equal(rows[1].right, "b");
  assert.equal(rows[1].left, null);
});

test("computeSideBySide: gemischt — change + remove", () => {
  const rows = D.computeSideBySide("erst\nalt\ndritt", "erst\nneu");
  assert.equal(rows[0].kind, "equal");
  assert.equal(rows[1].kind, "change");
  assert.equal(rows[1].left, "alt");
  assert.equal(rows[1].right, "neu");
  assert.equal(rows[2].kind, "remove");
  assert.equal(rows[2].left, "dritt");
});

test("hasChanges: equal-only → false", () => {
  assert.equal(D.hasChanges(D.computeSideBySide("x", "x")), false);
});

test("hasChanges: mit unterschied → true", () => {
  assert.equal(D.hasChanges(D.computeSideBySide("x", "y")), true);
});

test("computeSideBySide: beide leer → []", () => {
  assert.deepEqual(D.computeSideBySide("", ""), []);
});

test("computeSideBySide: nur lokal befüllt, remote leer → alles remove", () => {
  const rows = D.computeSideBySide("a\nb", "");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.kind === "remove"));
  assert.equal(rows[0].left, "a");
  assert.equal(rows[1].left, "b");
});
