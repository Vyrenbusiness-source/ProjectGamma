"use strict";

/**
 * Pure-JS Offline-Queue für optimistisches UI (desktop-spiegel zu
 * mobile-app/lib/features/offline_queue/offline_queue.dart).
 *
 * Keine I/O, keine DOM-Zugriffe — testbar mit node:test. Persistenz
 * übernimmt der Aufrufer (z.b. localStorage in sync-client.js) via
 * toJson/fromJson. Reihenfolge in list(): neueste zuerst.
 *
 * Public API:
 *   createOfflineQueue({ max?, now? })
 *     → { enqueue, list, pending, drainPending, markSent, markFailed,
 *         retry, drop, clear, toJson, fromJson }
 *   drainAndSend({ queue, sender }) — feuert sender(item) für jedes
 *     pending (chronologisch). sender → true → markSent. false → markFailed.
 *     Exception → markFailed mit error-message.
 *
 * Gerätelokal — niemals über sync_server gespiegelt.
 */

const OFFLINE_QUEUE_DEFAULT_MAX = 200;

function createOfflineQueue(opts) {
  const max = (opts && opts.max) || OFFLINE_QUEUE_DEFAULT_MAX;
  const now = (opts && opts.now) || (() => new Date());
  let seq = 0;
  let items = [];

  function newId() {
    seq += 1;
    return "oq_" + now().getTime() + "_" + seq;
  }

  function enforceCap() {
    if (items.length <= max) return;
    const keep = [];
    for (const i of items) {
      if (keep.length < max || i.status === "pending") keep.push(i);
    }
    items = keep.slice(0, Math.max(max, items.filter(i => i.status === "pending").length));
  }

  function enqueue(type, payload) {
    if (typeof type !== "string" || !type) {
      throw new Error("type darf nicht leer sein");
    }
    const item = {
      id: newId(),
      type,
      payload: { ...(payload || {}) },
      createdAt: now().toISOString(),
      status: "pending",
      retryCount: 0,
      error: null,
    };
    items.unshift(item);
    enforceCap();
    return item;
  }

  function byId(id) { return items.find(i => i.id === id) || null; }

  function markSent(id) {
    const i = byId(id);
    if (!i) return;
    i.status = "sent";
    i.error = null;
    enforceCap();
  }

  function markFailed(id, error) {
    const i = byId(id);
    if (!i) return;
    i.status = "failed";
    i.error = String(error || "fehler");
    i.retryCount += 1;
  }

  function retry(id) {
    const i = byId(id);
    if (!i) return;
    i.status = "pending";
    i.error = null;
  }

  function drop(id) { items = items.filter(i => i.id !== id); }
  function clear() { items = []; }
  function list() { return items.slice(); }
  function pending() { return items.filter(i => i.status === "pending"); }
  function drainPending() { return pending().slice().reverse(); }

  function toJson() { return { items: items.map(i => ({ ...i })) }; }

  function fromJson(json) {
    const raw = (json && json.items) || [];
    items = raw.map(r => ({
      id: String(r.id),
      type: String(r.type),
      payload: { ...(r.payload || {}) },
      createdAt: String(r.createdAt),
      status: ["pending", "sent", "failed"].includes(r.status) ? r.status : "pending",
      retryCount: Number(r.retryCount) || 0,
      error: r.error == null ? null : String(r.error),
    }));
    return api;
  }

  const api = {
    enqueue, list, pending, drainPending,
    markSent, markFailed, retry, drop, clear,
    toJson, fromJson,
  };
  return api;
}

async function drainAndSend({ queue, sender }) {
  const items = queue.drainPending();
  for (const item of items) {
    try {
      const ok = await sender(item);
      if (ok) queue.markSent(item.id);
      else queue.markFailed(item.id, "send fehlgeschlagen");
    } catch (e) {
      queue.markFailed(item.id, (e && e.message) || String(e));
    }
  }
}

if (typeof module !== "undefined") module.exports = { createOfflineQueue, drainAndSend };
if (typeof window !== "undefined") {
  window.createOfflineQueue = createOfflineQueue;
  window.drainAndSend = drainAndSend;
}
