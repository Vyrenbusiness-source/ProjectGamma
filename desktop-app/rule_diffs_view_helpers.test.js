// Tests für rule_diffs_view_helpers — pure, node:test-kompatibel.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./rule_diffs_view_helpers");

test("selectPending filtert nur status==='pending' aus project.ruleDiffs", () => {
  const project = {
    ruleDiffs: [
      { id: "a", status: "pending", action: "deactivate", ruleId: "r1", text: "x" },
      { id: "b", status: "approved", action: "activate", ruleId: "r2", text: "y" },
      { id: "c", status: "rejected", action: "deactivate", ruleId: "r3", text: "z" },
    ],
  };
  const out = h.selectPending(project);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "a");
});

test("selectPending verträgt fehlendes/leeres ruleDiffs", () => {
  assert.deepEqual(h.selectPending(null), []);
  assert.deepEqual(h.selectPending({}), []);
  assert.deepEqual(h.selectPending({ ruleDiffs: [] }), []);
});

test("formatDiffLabel beschreibt action menschlich auf deutsch", () => {
  assert.equal(
    h.formatDiffLabel({ action: "activate", text: "tdd" }),
    "aktivieren: tdd",
  );
  assert.equal(
    h.formatDiffLabel({ action: "deactivate", text: "kein log" }),
    "deaktivieren: kein log",
  );
  assert.equal(
    h.formatDiffLabel({ action: "weird", text: "x" }),
    "änderung: x",
  );
});

test("countPending zählt nur pending", () => {
  const project = {
    ruleDiffs: [
      { status: "pending" }, { status: "pending" }, { status: "approved" },
    ],
  };
  assert.equal(h.countPending(project), 2);
  assert.equal(h.countPending({}), 0);
});
