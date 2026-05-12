"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createUpnpPortmap } = require("./upnp_portmap.js");

function fakeNatUpnp({ mapFails = false, ipFails = false } = {}) {
  return {
    createClient() {
      return {
        portMapping(_opts, cb) {
          setTimeout(() => cb(mapFails ? new Error("mapping fail") : null), 5);
        },
        externalIp(cb) {
          setTimeout(() => cb(ipFails ? new Error("ip fail") : null, "203.0.113.42"), 5);
        },
        portUnmapping(_opts, cb) { setTimeout(() => cb(), 1); },
        close() {},
      };
    },
  };
}

test("open: active mit externalIp wenn alles klappt", async () => {
  const u = createUpnpPortmap({ natUpnp: fakeNatUpnp(), timeoutMs: 500, ttlSec: 7200 });
  const s = await u.open();
  assert.equal(s.status, "active");
  assert.equal(s.externalIp, "203.0.113.42");
  assert.equal(u.publicUrl(), "http://203.0.113.42:7892");
  await u.close();
});

test("open: error wenn mapping fails", async () => {
  const u = createUpnpPortmap({ natUpnp: fakeNatUpnp({ mapFails: true }), timeoutMs: 500 });
  const s = await u.open();
  assert.equal(s.status, "error");
  assert.match(s.error, /mapping fail/);
});

test("open: error wenn externalIp fails", async () => {
  const u = createUpnpPortmap({ natUpnp: fakeNatUpnp({ ipFails: true }), timeoutMs: 500 });
  const s = await u.open();
  assert.equal(s.status, "error");
  assert.match(s.error, /ip fail/);
});

test("open: timeout schlägt schnell zu", async () => {
  const stall = {
    createClient() {
      return {
        portMapping(_o, _cb) { /* nie aufrufen */ },
        externalIp(_cb) {},
        portUnmapping(_o, cb) { cb && cb(); },
        close() {},
      };
    },
  };
  const u = createUpnpPortmap({ natUpnp: stall, timeoutMs: 50 });
  const s = await u.open();
  assert.equal(s.status, "error");
  assert.match(s.error, /timeout/);
});

test("publicUrl liefert null wenn nicht active", () => {
  const u = createUpnpPortmap({ natUpnp: fakeNatUpnp() });
  assert.equal(u.publicUrl(), null);
});

test("disabled-stub wenn nat-upnp dep fehlt", () => {
  const u = createUpnpPortmap({ natUpnp: undefined });
  // Kein crash beim require — module-level fallback greift
  assert.equal(u.getStatus().status, "idle"); // wird beim ersten open auf error
});
