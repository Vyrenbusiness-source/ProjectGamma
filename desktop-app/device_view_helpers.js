// Pure helpers für die device-übersicht (desktop-app).
//
// Spiegelt die Server-Logik aus sync-server/lib/device_registry.js, damit
// der client beim WS-Push (lastSeen-Tick) ohne Roundtrip aktualisieren kann.
// Trennt Datenformung von der jsx-Komponente — testbar via node:test.
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.DeviceViewHelpers = mod;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULTS = Object.freeze({ onlineMs: 60_000, awayMs: 5 * 60_000 });

  function liveStatus(lastSeen, now, th) {
    const t = th || DEFAULTS;
    if (typeof lastSeen !== "number" || !Number.isFinite(lastSeen)) return "offline";
    const age = now - lastSeen;
    if (age <= t.onlineMs) return "online";
    if (age <= t.awayMs) return "away";
    return "offline";
  }

  function formatRelative(ts, now) {
    if (!ts) return "—";
    const diff = Math.max(0, now - ts);
    if (diff < 60_000) return "gerade eben";
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + " min";
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " std";
    return Math.floor(diff / 86_400_000) + " tage";
  }

  function statusLabel(status) {
    if (status === "online") return "online";
    if (status === "away") return "abwesend";
    return "offline";
  }

  // canRevoke: nur desktop-self darf revoken, eigene session ist tabu,
  // außerdem braucht der client das token (mobile sieht keins).
  function canRevoke(device, currentSession) {
    if (!device || !currentSession) return false;
    if (currentSession.deviceType !== "desktop") return false;
    if (device.isMe) return false;
    if (!device.token) return false;
    return true;
  }

  function refreshStatuses(devices, now, th) {
    if (!Array.isArray(devices)) return [];
    return devices.map((d) => ({
      ...d,
      status: liveStatus(d.lastSeen, now, th),
    }));
  }

  return { DEFAULTS, liveStatus, formatRelative, statusLabel, canRevoke, refreshStatuses };
});
