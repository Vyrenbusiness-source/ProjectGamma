// In-memory rate limiter für /api/pair/claim.
// Strategie: pro IP zählen wir FEHLVERSUCHE in einem rollierenden Fenster.
// Erfolgreiche Claims (200) zählen nicht — nur unbekannter/abgelaufener Code,
// fehlender Body etc. So kann ein legitimer Mobile-Claim nicht versehentlich
// einen anderen Client aussperren, aber Brute-Force auf den 6-stelligen Code
// (≈ 31^6 ≈ 887M, aber nur wenige Codes gleichzeitig aktiv) wird gebremst.
//
// Window: 60s. Max: 5 fehlversuche/IP. Danach 429 mit Retry-After.

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_FAILS = 5;

function createClaimRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  maxFails = DEFAULT_MAX_FAILS,
  now = Date.now,
} = {}) {
  /** @type {Map<string, number[]>} */
  const buckets = new Map();

  function prune(ip, t) {
    const list = buckets.get(ip);
    if (!list) return [];
    const cutoff = t - windowMs;
    const kept = list.filter((ts) => ts > cutoff);
    if (kept.length === 0) buckets.delete(ip);
    else buckets.set(ip, kept);
    return kept;
  }

  /**
   * Prüft, ob eine IP weitere claim-Versuche machen darf.
   * @returns {{allowed:true} | {allowed:false, retryAfterSec:number}}
   */
  function check(ip) {
    const t = now();
    const kept = prune(ip, t);
    if (kept.length >= maxFails) {
      const oldest = kept[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      return { allowed: false, retryAfterSec };
    }
    return { allowed: true };
  }

  /** Nur bei FEHLVERSUCH aufrufen. */
  function recordFailure(ip) {
    const t = now();
    const list = buckets.get(ip) || [];
    list.push(t);
    buckets.set(ip, list);
  }

  function reset(ip) {
    if (ip) buckets.delete(ip);
    else buckets.clear();
  }

  return { check, recordFailure, reset };
}

module.exports = { createClaimRateLimiter };
