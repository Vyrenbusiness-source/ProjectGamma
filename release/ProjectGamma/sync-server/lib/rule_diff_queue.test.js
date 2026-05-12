// node:test suite für rule_diff_queue.js (pure module).
// Sicher: cloud-code activate/deactivate-Vorschläge landen als pending-diffs,
// nicht als direkte TOGGLE_RULE-Mutation.

const test = require("node:test");
const assert = require("node:assert/strict");
const q = require("./rule_diff_queue");

function mkProject() {
  return {
    id: "p1",
    rules: [
      { id: "r-on", text: "regel A", active: true },
      { id: "r-off", text: "regel B", active: false },
    ],
    ruleDiffs: [],
  };
}

function fixedClock(start = 1000) {
  let t = start;
  return () => ++t;
}
function seqId() {
  let n = 0;
  return () => `d${++n}`;
}

test("buildDiffs: deactivate erzeugt pending-diff für aktive regel", () => {
  const diffs = q.buildDiffs(mkProject(), { deactivate: ["regel a"] }, {
    now: fixedClock(), genId: seqId(),
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0].id, /^d\d+$/);
  assert.equal(diffs[0].action, "deactivate");
  assert.equal(diffs[0].ruleId, "r-on");
  assert.equal(diffs[0].status, "pending");
});

test("buildDiffs: activate erzeugt diff nur für inaktive regel", () => {
  const diffs = q.buildDiffs(mkProject(), { activate: ["regel b", "regel a"] }, {
    now: fixedClock(), genId: seqId(),
  });
  // "regel a" ist bereits aktiv → kein diff; "regel b" inaktiv → diff
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].action, "activate");
  assert.equal(diffs[0].ruleId, "r-off");
});

test("buildDiffs: unbekannter text → kein diff", () => {
  const diffs = q.buildDiffs(mkProject(), { deactivate: ["unbekannt"] }, {
    now: fixedClock(), genId: seqId(),
  });
  assert.deepEqual(diffs, []);
});

test("enqueue: hängt neue diffs vorn an", () => {
  const p = mkProject();
  const diffs = q.buildDiffs(p, { deactivate: ["regel a"] }, { now: fixedClock(), genId: seqId() });
  const next = q.enqueue(p, diffs);
  assert.equal(next.ruleDiffs.length, 1);
  assert.equal(next.ruleDiffs[0].action, "deactivate");
});

test("enqueue: keine doppelten pending-einträge (action+ruleId)", () => {
  let p = mkProject();
  const gen = seqId();
  const d1 = q.buildDiffs(p, { deactivate: ["regel a"] }, { now: fixedClock(), genId: gen });
  p = q.enqueue(p, d1);
  const d2 = q.buildDiffs(p, { deactivate: ["regel a"] }, { now: fixedClock(), genId: gen });
  p = q.enqueue(p, d2);
  assert.equal(q.listPending(p).length, 1);
});

test("approveDiff: togglet rule.active und markiert approved", () => {
  let p = mkProject();
  const diffs = q.buildDiffs(p, { deactivate: ["regel a"] }, { now: fixedClock(), genId: seqId() });
  p = q.enqueue(p, diffs);
  const diffId = p.ruleDiffs[0].id;
  const res = q.approveDiff(p, diffId);
  assert.equal(res.applied, true);
  assert.equal(res.project.rules.find(r => r.id === "r-on").active, false);
  assert.equal(res.project.ruleDiffs[0].status, "approved");
});

test("approveDiff: ignoriert nicht-pending eintrag (idempotent)", () => {
  let p = mkProject();
  p.ruleDiffs = [{ id: "d-x", action: "activate", ruleId: "r-off", text: "regel B", status: "approved", ts: 1 }];
  const res = q.approveDiff(p, "d-x");
  assert.equal(res.applied, false);
  assert.equal(res.project.rules.find(r => r.id === "r-off").active, false);
});

test("rejectDiff: markiert rejected, rules unverändert", () => {
  let p = mkProject();
  const diffs = q.buildDiffs(p, { activate: ["regel b"] }, { now: fixedClock(), genId: seqId() });
  p = q.enqueue(p, diffs);
  const diffId = p.ruleDiffs[0].id;
  const res = q.rejectDiff(p, diffId);
  assert.equal(res.rejected, true);
  assert.equal(res.project.rules.find(r => r.id === "r-off").active, false);
  assert.equal(res.project.ruleDiffs[0].status, "rejected");
});

test("listPending: liefert nur pending-einträge", () => {
  const p = {
    ...mkProject(),
    ruleDiffs: [
      { id: "a", status: "pending", action: "activate", ruleId: "r-off", ts: 1 },
      { id: "b", status: "approved", action: "deactivate", ruleId: "r-on", ts: 2 },
      { id: "c", status: "rejected", action: "activate", ruleId: "r-off", ts: 3 },
    ],
  };
  const pending = q.listPending(p);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "a");
});
