"use strict";

/**
 * Pure helper: in-memory Inbox für PUSH_NOTIFICATION-Events vom sync-server.
 * Keine I/O, keine DOM-Zugriffe — testbar mit node:test.
 *
 * Public API: createInbox({ max }) → { push, list, unreadCount, markRead,
 *   markAllRead, drop, clear }
 *
 * Items sind die vom server gelieferten notification-Objekte aus
 * lib/notify_dispatch.js (id, type, title, body, projectId, priority,
 * createdAt). Reihenfolge in list(): neueste zuerst. Cap (default 50) wirft
 * älteste raus. Re-push gleicher id ersetzt das Item ohne Status-Reset.
 */

const NOTIF_INBOX_DEFAULT_MAX = 50;
const REQUIRED = ["id", "type", "title", "body", "createdAt"];

function isValid(item) {
  if (!item || typeof item !== "object") return false;
  for (const k of REQUIRED) if (typeof item[k] !== "string" || !item[k]) return false;
  return true;
}

function createInbox(opts) {
  const max = (opts && opts.max) || NOTIF_INBOX_DEFAULT_MAX;
  const items = [];
  const read = new Set();

  function push(item) {
    if (!isValid(item)) return false;
    const idx = items.findIndex(x => x.id === item.id);
    if (idx >= 0) { items.splice(idx, 1); }
    items.unshift({ ...item });
    while (items.length > max) {
      const dropped = items.pop();
      read.delete(dropped.id);
    }
    return true;
  }

  function list() { return items.slice(); }
  function unreadCount() {
    return items.reduce((c, x) => c + (read.has(x.id) ? 0 : 1), 0);
  }
  function markRead(id) { if (items.some(x => x.id === id)) read.add(id); }
  function markAllRead() { for (const x of items) read.add(x.id); }
  function drop(id) {
    const i = items.findIndex(x => x.id === id);
    if (i >= 0) { items.splice(i, 1); read.delete(id); }
  }
  function clear() { items.length = 0; read.clear(); }

  return { push, list, unreadCount, markRead, markAllRead, drop, clear };
}

if (typeof module !== "undefined") module.exports = { createInbox };
if (typeof window !== "undefined") window.createNotificationsInbox = createInbox;
