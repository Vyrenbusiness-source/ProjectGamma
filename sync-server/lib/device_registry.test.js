const test = require("node:test");
const assert = require("node:assert/strict");
const {
  liveStatus,
  lastActivityForDevice,
  summarizeDevices,
  DEFAULT_THRESHOLDS,
} = require("./device_registry");

const NOW = 1_700_000_000_000;

test("liveStatus: frischer ping → online", () => {
  assert.equal(liveStatus(NOW - 10_000, NOW), "online");
});
test("liveStatus: > onlineMs aber < awayMs → away", () => {
  assert.equal(liveStatus(NOW - 2 * 60_000, NOW), "away");
});
test("liveStatus: > awayMs → offline", () => {
  assert.equal(liveStatus(NOW - 10 * 60_000, NOW), "offline");
});
test("liveStatus: fehlender lastSeen → offline", () => {
  assert.equal(liveStatus(undefined, NOW), "offline");
});

test("lastActivityForDevice matcht via deviceName und source", () => {
  const project = {
    activity: [
      { source: "mobile", at: NOW - 1000, deviceName: "phone" },
      { source: "desktop", at: NOW - 500, deviceName: "pc" },
      { source: "system", at: NOW - 100 },
    ],
  };
  assert.equal(lastActivityForDevice(project, "phone", "mobile"), NOW - 1000);
  assert.equal(lastActivityForDevice(project, "pc", "desktop"), NOW - 500);
  assert.equal(lastActivityForDevice(project, "unknown", "tv"), null);
});

test("summarizeDevices markiert eigene session + sortiert nach status", () => {
  const sessions = new Map([
    ["t1", { deviceName: "phone", deviceType: "mobile", since: NOW - 9e6, lastSeen: NOW - 10 * 60_000 }],
    ["t2", { deviceName: "pc",    deviceType: "desktop", since: NOW - 9e6, lastSeen: NOW - 10_000 }],
    ["t3", { deviceName: "tab",   deviceType: "mobile", since: NOW - 9e6, lastSeen: NOW - 2 * 60_000 }],
  ]);
  const project = { id: "p1", activity: [
    { source: "mobile", at: NOW - 1000, deviceName: "phone" },
  ]};
  const out = summarizeDevices({ sessions, project, currentToken: "t2", now: NOW });
  assert.equal(out.length, 3);
  assert.equal(out[0].status, "online");
  assert.equal(out[0].deviceName, "pc");
  assert.equal(out[0].isMe, true);
  assert.equal(out[1].status, "away");
  assert.equal(out[2].status, "offline");
  assert.equal(out[2].lastActivityInProjectAt, NOW - 1000);
});

test("summarizeDevices: ohne project → lastActivityInProjectAt null", () => {
  const sessions = new Map([["t1", { deviceName: "x", deviceType: "mobile", lastSeen: NOW }]]);
  const out = summarizeDevices({ sessions, project: null, currentToken: "t1", now: NOW });
  assert.equal(out[0].lastActivityInProjectAt, null);
});

test("DEFAULT_THRESHOLDS sind eingefroren", () => {
  assert.equal(Object.isFrozen(DEFAULT_THRESHOLDS), true);
});

test("summarizeDevices wirft bei kaputtem input", () => {
  assert.throws(() => summarizeDevices({ sessions: null, project: null, currentToken: "", now: 0 }));
  assert.throws(() => summarizeDevices({ sessions: new Map(), project: null, currentToken: "", now: "x" }));
});
