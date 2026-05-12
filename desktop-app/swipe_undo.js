/**
 * Pure-JS Helper für Swipe-to-complete + Undo (Desktop-App).
 * Spiegelt mobile-app/lib/features/swipe_undo/swipe_undo.dart.
 * Kein DOM-/React-Import — testbar via node:test.
 *
 * Public API:
 *  - inverseMutation(type, payload): liefert {type, payload} zur Umkehr,
 *    null falls nicht umkehrbar.
 *  - UndoStack: gerätelokaler In-Memory-Stack mit TTL (Default 5s).
 *
 * Hinweis: Undo ist UI-State (analog Theme/UI-Regel) und wird NICHT
 * über den sync_server gespiegelt.
 */

'use strict';

function inverseMutation(type, payload) {
  const p = { ...(payload || {}) };
  switch (type) {
    case 'TOGGLE_TASK':
      return { type: 'TOGGLE_TASK', payload: p };
    case 'DISMISS_IDEA':
    case 'CONVERT_IDEA':
      return { type: 'REACTIVATE_IDEA', payload: p };
    case 'REACTIVATE_IDEA':
      return { type: 'DISMISS_IDEA', payload: p };
    default:
      return null;
  }
}

class UndoStack {
  /**
   * @param {{ttlMs?: number, now?: () => number}} [opts]
   */
  constructor(opts = {}) {
    this.ttlMs = opts.ttlMs ?? 5000;
    this._now = opts.now ?? (() => Date.now());
    this._entries = [];
  }

  /**
   * @param {{id:string,label:string,mutationType:string,payload:object,createdAt?:number}} entry
   */
  push(entry) {
    if (!entry || !entry.id || !entry.mutationType) {
      throw new Error('UndoStack.push: id und mutationType erforderlich');
    }
    this._entries.push({
      id: entry.id,
      label: entry.label || '',
      mutationType: entry.mutationType,
      payload: { ...(entry.payload || {}) },
      createdAt: entry.createdAt ?? this._now(),
    });
  }

  /** Aktive (nicht abgelaufene) Einträge. */
  get active() {
    const cutoff = this._now() - this.ttlMs;
    return this._entries.filter((e) => e.createdAt > cutoff);
  }

  /**
   * Entfernt Eintrag mit id und gibt ihn zurück (null falls nicht (mehr) da).
   * @param {string} id
   */
  consume(id) {
    const ix = this._entries.findIndex((e) => e.id === id);
    if (ix < 0) return null;
    const [removed] = this._entries.splice(ix, 1);
    return removed;
  }

  /** Entfernt abgelaufene Einträge. Gibt Anzahl entfernter zurück. */
  purgeExpired() {
    const cutoff = this._now() - this.ttlMs;
    const before = this._entries.length;
    this._entries = this._entries.filter((e) => e.createdAt > cutoff);
    return before - this._entries.length;
  }

  get size() {
    return this._entries.length;
  }
}

/**
 * Filter: ghost-pending items (__pending===true) dürfen nicht swipe-bar sein.
 * Verhindert, dass offline-queue-eintrag während sync verworfen wird.
 */
function isSwipeable(item) {
  if (!item) return false;
  return item.__pending !== true;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { inverseMutation, UndoStack, isSwipeable };
}

if (typeof window !== 'undefined') {
  window.swipeUndo = { inverseMutation, UndoStack, isSwipeable };
}
