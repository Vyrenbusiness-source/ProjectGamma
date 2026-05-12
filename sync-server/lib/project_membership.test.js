"use strict";
/**
 * Tests fuer lib/project_membership.js — multi-user schicht 2.
 * In-memory sqlite via node:sqlite (DatabaseSync).
 */

const test = require("node:test");
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { createUsersStore } = require("./users_store");
const { createProjectMembershipStore, ROLES } = require("./project_membership");

function setup() {
  const db = new DatabaseSync(":memory:");
  const users = createUsersStore({ db });
  const memberships = createProjectMembershipStore({ db });
  const owner = users.registerUser({ email: "o@x.de", passwordHash: "h1" });
  const guest = users.registerUser({ email: "g@x.de", passwordHash: "h2" });
  return { db, users, memberships, owner, guest };
}

test("addMember persistiert eintrag mit rolle", () => {
  const { memberships, owner } = setup();
  const m = memberships.addMember({ projectId: "p1", userId: owner.id, role: ROLES.OWNER, addedBy: owner.id });
  assert.equal(m.projectId, "p1");
  assert.equal(m.userId, owner.id);
  assert.equal(m.role, ROLES.OWNER);
  assert.ok(typeof m.addedAt === "number");
});

test("addMember verweigert unbekannten user (FK)", () => {
  const { memberships, owner } = setup();
  assert.throws(
    () => memberships.addMember({ projectId: "p1", userId: "ghost", role: ROLES.MEMBER, addedBy: owner.id }),
    /unknown user|FOREIGN/
  );
});

test("addMember verweigert ungueltige rolle", () => {
  const { memberships, owner } = setup();
  assert.throws(
    () => memberships.addMember({ projectId: "p1", userId: owner.id, role: "boss", addedBy: owner.id }),
    /role/
  );
});

test("addMember ist idempotent (uniq projectId+userId) und updated rolle", () => {
  const { memberships, owner } = setup();
  memberships.addMember({ projectId: "p1", userId: owner.id, role: ROLES.MEMBER, addedBy: owner.id });
  memberships.addMember({ projectId: "p1", userId: owner.id, role: ROLES.OWNER, addedBy: owner.id });
  assert.equal(memberships.getRole("p1", owner.id), ROLES.OWNER);
  assert.equal(memberships.listMembers("p1").length, 1);
});

test("listMembers gibt alle member eines projekts", () => {
  const { memberships, owner, guest } = setup();
  memberships.addMember({ projectId: "p1", userId: owner.id, role: ROLES.OWNER, addedBy: owner.id });
  memberships.addMember({ projectId: "p1", userId: guest.id, role: ROLES.MEMBER, addedBy: owner.id });
  const rows = memberships.listMembers("p1");
  assert.equal(rows.length, 2);
  const ids = rows.map((r) => r.userId).sort();
  assert.deepEqual(ids, [owner.id, guest.id].sort());
});

test("listProjectsForUser gibt projekte mit rolle zurueck", () => {
  const { memberships, owner } = setup();
  memberships.addMember({ projectId: "p1", userId: owner.id, role: ROLES.OWNER, addedBy: owner.id });
  memberships.addMember({ projectId: "p2", userId: owner.id, role: ROLES.MEMBER, addedBy: owner.id });
  const rows = memberships.listProjectsForUser(owner.id);
  assert.equal(rows.length, 2);
  const map = Object.fromEntries(rows.map((r) => [r.projectId, r.role]));
  assert.equal(map.p1, ROLES.OWNER);
  assert.equal(map.p2, ROLES.MEMBER);
});

test("removeMember entfernt eintrag", () => {
  const { memberships, owner, guest } = setup();
  memberships.addMember({ projectId: "p1", userId: owner.id, role: ROLES.OWNER, addedBy: owner.id });
  memberships.addMember({ projectId: "p1", userId: guest.id, role: ROLES.MEMBER, addedBy: owner.id });
  memberships.removeMember("p1", guest.id);
  assert.equal(memberships.getRole("p1", guest.id), null);
  assert.equal(memberships.listMembers("p1").length, 1);
});

test("hasRole prueft min-rolle (owner > member > viewer)", () => {
  const { memberships, owner, guest } = setup();
  memberships.addMember({ projectId: "p1", userId: owner.id, role: ROLES.OWNER, addedBy: owner.id });
  memberships.addMember({ projectId: "p1", userId: guest.id, role: ROLES.VIEWER, addedBy: owner.id });
  assert.equal(memberships.hasRole("p1", owner.id, ROLES.MEMBER), true);
  assert.equal(memberships.hasRole("p1", guest.id, ROLES.MEMBER), false);
  assert.equal(memberships.hasRole("p1", guest.id, ROLES.VIEWER), true);
  assert.equal(memberships.hasRole("p1", "ghost", ROLES.VIEWER), false);
});
