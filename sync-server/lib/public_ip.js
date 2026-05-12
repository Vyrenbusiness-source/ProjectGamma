"use strict";
/**
 * lib/public_ip.js
 * Erkennt die public-IP des servers via öffentliche stun-/http-services.
 *
 * Use-case: user hat port-forwarding manuell eingerichtet (oder UPnP klappte)
 * → mobile-client kann direkt via public-IP:port verbinden ohne ngrok-tunnel.
 *
 * Mehrere services parallel als fallback (race-pattern), erster erfolg gewinnt.
 * 3s timeout pro service, cached für ein paar minuten.
 */

const https = require("https");
const http = require("http");

const DEFAULT_SERVICES = [
  { url: "https://api.ipify.org",          parse: (s) => s.trim() },
  { url: "https://ifconfig.me/ip",          parse: (s) => s.trim() },
  { url: "https://icanhazip.com",           parse: (s) => s.trim() },
  { url: "https://api64.ipify.org",         parse: (s) => s.trim() },
];

const CACHE_TTL_MS = 5 * 60 * 1000;

function fetchUrl(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error("http " + res.statusCode)); return; }
      let data = "";
      res.on("data", (c) => { data += c.toString(); if (data.length > 256) req.destroy(new Error("too much data")); });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
  });
}

function isValidIpv4(s) {
  if (typeof s !== "string") return false;
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const n = parseInt(m[i], 10);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function createPublicIpResolver({ services = DEFAULT_SERVICES, fetch = fetchUrl, now = Date.now } = {}) {
  let cache = { ip: null, ts: 0, error: null };

  async function resolve({ force = false } = {}) {
    if (!force && cache.ip && (now() - cache.ts) < CACHE_TTL_MS) {
      return { ip: cache.ip, cached: true, error: null };
    }
    // race über alle services — erster gewinnt
    let lastErr = null;
    for (const svc of services) {
      try {
        const raw = await fetch(svc.url);
        const ip = svc.parse(raw);
        if (isValidIpv4(ip)) {
          cache = { ip, ts: now(), error: null };
          return { ip, cached: false, error: null };
        }
      } catch (e) { lastErr = e; }
    }
    const err = lastErr ? lastErr.message : "all services failed";
    cache = { ip: null, ts: now(), error: err };
    return { ip: null, cached: false, error: err };
  }

  function getCached() {
    if (!cache.ip) return { ip: null, error: cache.error };
    if ((now() - cache.ts) >= CACHE_TTL_MS) return { ip: null, error: "cache expired" };
    return { ip: cache.ip, error: null };
  }

  return { resolve, getCached };
}

module.exports = { createPublicIpResolver, isValidIpv4 };
