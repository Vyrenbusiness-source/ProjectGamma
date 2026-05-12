const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./device_view_helpers");

const NOW = 1_700_000_000_000;

test("liveStatus: online/away/offline-buckets", () => {
  assert.equal(H.liveStatus(NOW - 30_000, NOW), "online");
  assert.equal(H.liveStatus(NOW - 120_000, NOW), "away");
  assert.equal(H.liveStatus(NOW - 10 * 60_000, NOW), "offline");
  assert.equal(H.liveStatus(null, NOW), "offline");
});

test("formatRelative: menschlich gerundet", () => {
  assert.equal(H.formatRelative(NOW - 10_000, NOW), "gerade eben");
  assert.equal(H.formatRelative(NOW - 5 * 60_000, NOW), "5 min");
  assert.equal(H.formatRelative(NOW - 3 * 3_600_000, NOW), "3 std");
  assert.equal(H.formatRelative(0, NOW), "—");
});

test("statusLabel mappt deutsch", () => {
  assert.equal(H.statusLabel("online"), "online");
  assert.equal(H.statusLabel("away"), "abwesend");
  assert.equal(H.statusLabel("offline"), "offline");
});

test("canRevoke: nur desktop, nicht self, token erforderlich", () => {
  const me = { deviceType: "desktop" };
  assert.equal(H.canRevoke({ token: "t", isMe: false }, me), true);
  assert.equal(H.canRevoke({ token: "t", isMe: true  }, me), false);
  assert.equal(H.canRevoke({ token: null, isMe: false }, me), false);
  assert.equal(H.canRevoke({ token: "t", isMe: false }, { deviceType: "mobile" }), false);
  assert.equal(H.canRevoke(null, me), false);
});

test("refreshStatuses berechnet status anhand now", () => {
  const list = [
    { token: "a", lastSeen: NOW - 5_000, status: "offline" },
    { token: "b", lastSeen: NOW - 10 * 60_000, status: "online" },
  ];
  const out = H.refreshStatuses(list, NOW);
  assert.equal(out[0].status, "online");
  assert.equal(out[1].status, "offline");
});
