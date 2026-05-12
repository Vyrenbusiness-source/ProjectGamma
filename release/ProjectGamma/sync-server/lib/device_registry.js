// Pure-Logik für die Pro-Projekt-Geräteübersicht.
// Keine I/O, keine express-/ws-Abhängigkeiten — testbar mit node:test.
//
// Eingaben:
//   sessions: Map<token, { deviceName, deviceType, since, lastSeen, pairedWith }>
//   project:  { id, activity: [{ source, at, deviceName? }, ...] } | null
//   currentToken: string                                    (für isMe-Flag)
//   now: number (ms)                                        (Testbarkeit)
//   thresholds: { onlineMs, awayMs }                        (Live-Status-Buckets)
//
// Ausgabe: Array<{
//   token, deviceName, deviceType, since, lastSeen,
//   status: 'online'|'away'|'offline',
//   lastActivityInProjectAt: number|null,
//   isMe: boolean,
// }> sortiert nach (status-rang, lastActivityInProjectAt desc, lastSeen desc).

const DEFAULT_THRESHOLDS = Object.freeze({ onlineMs: 60_000, awayMs: 5 * 60_000 });
const STATUS_RANK = { online: 0, away: 1, offline: 2 };

function liveStatus(lastSeen, now, thresholds = DEFAULT_THRESHOLDS) {
  if (typeof lastSeen !== "number" || !Number.isFinite(lastSeen)) return "offline";
  const age = now - lastSeen;
  if (age <= thresholds.onlineMs) return "online";
  if (age <= thresholds.awayMs) return "away";
  return "offline";
}

function lastActivityForDevice(project, deviceName, deviceType) {
  if (!project || !Array.isArray(project.activity)) return null;
  let best = null;
  for (const ev of project.activity) {
    if (!ev || typeof ev.at !== "number") continue;
    const matchesName = ev.deviceName && deviceName && ev.deviceName === deviceName;
    const matchesSource = ev.source && deviceType && ev.source === deviceType;
    if (!matchesName && !matchesSource) continue;
    if (best === null || ev.at > best) best = ev.at;
  }
  return best;
}

function summarizeDevices({ sessions, project, currentToken, now, thresholds }) {
  if (!sessions || typeof sessions.entries !== "function") {
    throw new TypeError("sessions muss eine Map sein");
  }
  if (typeof now !== "number") throw new TypeError("now muss eine number sein");
  const th = thresholds || DEFAULT_THRESHOLDS;
  const list = [];
  for (const [token, s] of sessions) {
    if (!s) continue;
    const status = liveStatus(s.lastSeen, now, th);
    list.push({
      token,
      deviceName: s.deviceName || "",
      deviceType: s.deviceType || "",
      since: s.since || 0,
      lastSeen: s.lastSeen || 0,
      status,
      lastActivityInProjectAt: lastActivityForDevice(project, s.deviceName, s.deviceType),
      isMe: token === currentToken,
    });
  }
  list.sort((a, b) => {
    const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (r !== 0) return r;
    const la = a.lastActivityInProjectAt || 0;
    const lb = b.lastActivityInProjectAt || 0;
    if (la !== lb) return lb - la;
    return (b.lastSeen || 0) - (a.lastSeen || 0);
  });
  return list;
}

function publicView(device, { includeToken }) {
  return {
    token: includeToken ? device.token : undefined,
    deviceName: device.deviceName,
    deviceType: device.deviceType,
    since: device.since,
    lastSeen: device.lastSeen,
    status: device.status,
    lastActivityInProjectAt: device.lastActivityInProjectAt,
    isMe: device.isMe,
  };
}

module.exports = {
  DEFAULT_THRESHOLDS,
  liveStatus,
  lastActivityForDevice,
  summarizeDevices,
  publicView,
};
