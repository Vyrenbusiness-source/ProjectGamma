"use strict";
/**
 * lib/upnp_portmap.js
 * Automatisches port-mapping via UPnP (Router-IGD-Protokoll).
 *
 * Wenn der heim-router UPnP unterstützt (~70% der consumer-router default ON):
 *   - Server fordert beim boot ein port-mapping LAN-port 7892 → WAN-port 7892
 *   - Liest die public-IP des routers aus
 *   - Mobile kann sich dann via http://<public-ip>:7892 verbinden, auch über
 *     mobiles-internet (keine WLAN-/USB-bindung nötig)
 *
 * Falls UPnP nicht klappt (router-firewall, gehärtete config): kein crash,
 * fallback bleibt LAN + optional ngrok.
 *
 * Pure-ish: nat-upnp-client als dep injizierbar für tests.
 */

const DEFAULT_TIMEOUT_MS = 5000;

function createUpnpPortmap({
  natUpnp,
  internalPort = 7892,
  externalPort = 7892,
  description = "ProjectGamma sync-server",
  ttlSec = 3600 * 24, // 24h, danach refresh
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!natUpnp) {
    try { natUpnp = require("nat-upnp"); }
    catch (e) {
      return _disabledStub("nat-upnp nicht installiert: " + (e && e.message));
    }
  }
  let client = null;
  let state = { status: "idle", externalIp: null, error: null, mappedAt: null };
  let listeners = new Set();
  let refreshTimer = null;

  function emit() { for (const fn of listeners) try { fn({ ...state }); } catch (_) {} }

  function ensureClient() {
    if (!client) client = natUpnp.createClient();
    return client;
  }

  function withTimeout(promise, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label + " timeout")), timeoutMs);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  function getExternalIp() {
    return new Promise((resolve, reject) => {
      ensureClient().externalIp((err, ip) => err ? reject(err) : resolve(ip));
    });
  }

  function portMapping() {
    return new Promise((resolve, reject) => {
      ensureClient().portMapping({
        public: externalPort, private: internalPort, ttl: ttlSec, description,
      }, (err) => err ? reject(err) : resolve());
    });
  }

  function portUnmapping() {
    return new Promise((resolve) => {
      ensureClient().portUnmapping({ public: externalPort }, () => resolve());
    });
  }

  async function open() {
    if (state.status === "active") return getStatus();
    state = { status: "starting", externalIp: null, error: null, mappedAt: null };
    emit();
    try {
      await withTimeout(portMapping(), "portMapping");
      const ip = await withTimeout(getExternalIp(), "externalIp");
      state = { status: "active", externalIp: ip, error: null, mappedAt: Date.now() };
      // Refresh kurz vor TTL-ende
      refreshTimer = setTimeout(() => {
        portMapping().catch((e) => {
          state = { ...state, status: "error", error: "refresh failed: " + e.message };
          emit();
        });
      }, Math.max(60_000, (ttlSec - 60) * 1000));
      emit();
    } catch (e) {
      state = { status: "error", externalIp: null, error: e.message, mappedAt: null };
      emit();
    }
    return getStatus();
  }

  async function close() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    try { await portUnmapping(); } catch (_) {}
    try { client && client.close(); } catch (_) {}
    client = null;
    state = { status: "idle", externalIp: null, error: null, mappedAt: null };
    emit();
    return getStatus();
  }

  function getStatus() { return { ...state }; }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function publicUrl(scheme = "http") {
    if (!state.externalIp || state.status !== "active") return null;
    return `${scheme}://${state.externalIp}:${externalPort}`;
  }

  return { open, close, getStatus, publicUrl, onChange };
}

function _disabledStub(reason) {
  const state = { status: "error", externalIp: null, error: reason, mappedAt: null };
  return {
    open: async () => state,
    close: async () => state,
    getStatus: () => state,
    publicUrl: () => null,
    onChange: () => () => {},
  };
}

module.exports = { createUpnpPortmap };
