"use strict";

/**
 * Pure-Helper für Per-Message-Revalidierung von WebSocket-Sessions.
 *
 * Hintergrund: Bei WS-Verbindungsaufbau wird die Session-Referenz gecacht.
 * Wird sie zwischenzeitlich via /api/logout oder DELETE /api/sessions/:token
 * widerrufen, dürfen MUT-Nachrichten der gecachten ws-Verbindung nicht mehr
 * akzeptiert werden. Diese Funktion liefert die aktuelle Session aus der
 * Map ODER null, sodass der Caller schließen kann.
 *
 * @param {Map<string,object>} sessions – aktuelle sessions-Map
 * @param {string|undefined} token – das beim Connect gecachte token
 * @returns {object|null} aktuelle session oder null wenn revoked/unbekannt
 */
function resolveLiveSession(sessions, token) {
  if (!token || !sessions || !sessions.has(token)) return null;
  return sessions.get(token) || null;
}

module.exports = { resolveLiveSession };
