"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isUserSession, allowedProjectIds, filterStateForSession, checkMutationAccess,
} = require("./project_access.js");

function fakeDeps(memberships, roles) {
  return {
    listProjectsForUser: (userId) => memberships[userId] || [],
    hasRole: (projectId, userId, minRole) => {
      const r = (roles[userId] || {})[projectId];
      if (!r) return false;
      const rank = { owner: 3, member: 2, viewer: 1 };
      return rank[r] >= rank[minRole];
    },
  };
}

const pairSess  = { deviceName: "desktop", deviceType: "desktop", since: 0, lastSeen: 0 };
const userSess  = { deviceName: "u@e.de", deviceType: "user", userId: "u1", since: 0, lastSeen: 0 };
const fullState = {
  projects: [{ id: "a" }, { id: "b" }, { id: "c" }],
  syncLog: [], ccRunning: false,
};

test("isUserSession unterscheidet user/pair", () => {
  assert.equal(isUserSession(userSess), true);
  assert.equal(isUserSession(pairSess), false);
  assert.equal(isUserSession(null), false);
});

test("filterStateForSession: pair-session = vollzugriff (unverändert)", () => {
  const deps = fakeDeps({}, {});
  const out = filterStateForSession(fullState, pairSess, deps);
  assert.equal(out, fullState); // identity → kein clone
});

test("filterStateForSession: user-session sieht nur erlaubte projekte", () => {
  const deps = fakeDeps({ u1: [{ projectId: "a" }, { projectId: "c" }] }, {});
  const out = filterStateForSession(fullState, userSess, deps);
  assert.deepEqual(out.projects.map((p) => p.id), ["a", "c"]);
  assert.notEqual(out, fullState); // neue ref
});

test("filterStateForSession: user ohne memberships → leere projektliste", () => {
  const deps = fakeDeps({}, {});
  const out = filterStateForSession(fullState, userSess, deps);
  assert.deepEqual(out.projects, []);
});

test("allowedProjectIds: pair-session → null (alle)", () => {
  assert.equal(allowedProjectIds(pairSess, fakeDeps({}, {})), null);
});

test("checkMutationAccess: pair-session passiert alle writes", () => {
  const r = checkMutationAccess("ADD_TASK", { projectId: "a" }, pairSess, fakeDeps({}, {}));
  assert.equal(r.ok, true);
});

test("checkMutationAccess: user mit member-rolle darf schreiben", () => {
  const deps = fakeDeps({}, { u1: { a: "member" } });
  const r = checkMutationAccess("ADD_TASK", { projectId: "a" }, userSess, deps);
  assert.equal(r.ok, true);
});

test("checkMutationAccess: user ohne rolle wird abgelehnt (403)", () => {
  const deps = fakeDeps({}, { u1: { b: "owner" } });
  const r = checkMutationAccess("ADD_TASK", { projectId: "a" }, userSess, deps);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("checkMutationAccess: viewer wird bei write abgelehnt", () => {
  const deps = fakeDeps({}, { u1: { a: "viewer" } });
  const r = checkMutationAccess("ADD_TASK", { projectId: "a" }, userSess, deps);
  assert.equal(r.ok, false);
});

test("checkMutationAccess: globale mutations brauchen keine rolle", () => {
  const deps = fakeDeps({}, {});
  const r = checkMutationAccess("TOGGLE_CC", { running: true }, userSess, deps);
  assert.equal(r.ok, true);
});

test("checkMutationAccess: write-mutation ohne projectId → 400", () => {
  const r = checkMutationAccess("ADD_TASK", {}, userSess, fakeDeps({}, {}));
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test("checkMutationAccess: ADD_PROJECT ist global, jeder user darf", () => {
  const r = checkMutationAccess("ADD_PROJECT", { project: { name: "x" } }, userSess, fakeDeps({}, {}));
  assert.equal(r.ok, true);
});

test("checkMutationAccess: ADD_MESSAGE blockt fremden user", () => {
  const deps = fakeDeps({}, { u1: { other: "owner" } });
  const r = checkMutationAccess("ADD_MESSAGE", { projectId: "a", message: { text: "hi" } }, userSess, deps);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test("checkMutationAccess: ADD_MESSAGE klappt für member", () => {
  const deps = fakeDeps({}, { u1: { a: "member" } });
  const r = checkMutationAccess("ADD_MESSAGE", { projectId: "a", message: { text: "hi" } }, userSess, deps);
  assert.equal(r.ok, true);
});

test("checkMutationAccess: ADD_APPOINTMENT als viewer geblockt", () => {
  const deps = fakeDeps({}, { u1: { a: "viewer" } });
  const r = checkMutationAccess("ADD_APPOINTMENT", { projectId: "a", appointment: { title: "x", when: "2026-01-01" } }, userSess, deps);
  assert.equal(r.ok, false);
});
