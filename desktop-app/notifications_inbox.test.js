"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createInbox } = require("./notifications_inbox");

const n = (id, extra = {}) => ({
  id, type: "cc_done", title: "t", body: "b",
  projectId: "p1", priority: "normal",
  createdAt: "2026-05-10T00:00:00.000Z", ...extra,
});

test("push fügt hinzu, dedupliziert per id und cap respektiert reihenfolge", () => {
  const inbox = createInbox({ max: 3 });
  inbox.push(n("a")); inbox.push(n("b")); inbox.push(n("a"));
  assert.deepEqual(inbox.list().map(x => x.id), ["a", "b"]);
  inbox.push(n("c")); inbox.push(n("d"));
  assert.deepEqual(inbox.list().map(x => x.id), ["d", "c", "a"]);
});

test("unreadCount und markRead funktionieren", () => {
  const inbox = createInbox();
  inbox.push(n("a")); inbox.push(n("b"));
  assert.equal(inbox.unreadCount(), 2);
  inbox.markRead("a");
  assert.equal(inbox.unreadCount(), 1);
  inbox.markAllRead();
  assert.equal(inbox.unreadCount(), 0);
});

test("invalid input wird ignoriert", () => {
  const inbox = createInbox();
  inbox.push(null); inbox.push({}); inbox.push({ id: "x" });
  assert.equal(inbox.list().length, 0);
});
