/// Pure-dart Spiegel der server-seitigen device-registry (siehe
/// sync-server/lib/device_registry.js). Berechnet live-status pro session
/// und projektbezogene last-activity. Keine Flutter-Imports — direkt mit
/// `test` ausführbar.
///
/// Eingabe-shape (analog zu GET /api/projects/:id/devices):
///   [{ token?, deviceName, deviceType, since, lastSeen, isMe,
///      status, lastActivityInProjectAt }]
class DeviceStatus {
  static const online = 'online';
  static const away = 'away';
  static const offline = 'offline';
}

class DeviceThresholds {
  const DeviceThresholds({this.onlineMs = 60_000, this.awayMs = 5 * 60_000});
  final int onlineMs;
  final int awayMs;
  static const defaults = DeviceThresholds();
}

String liveStatus(int? lastSeen, int now, [DeviceThresholds? th]) {
  if (lastSeen == null) return DeviceStatus.offline;
  final t = th ?? DeviceThresholds.defaults;
  final age = now - lastSeen;
  if (age <= t.onlineMs) return DeviceStatus.online;
  if (age <= t.awayMs) return DeviceStatus.away;
  return DeviceStatus.offline;
}

String statusLabel(String status) {
  switch (status) {
    case DeviceStatus.online: return 'online';
    case DeviceStatus.away: return 'abwesend';
    default: return 'offline';
  }
}

String formatRelative(int? ts, int now) {
  if (ts == null || ts == 0) return '—';
  final diff = (now - ts).clamp(0, 1 << 62);
  if (diff < 60_000) return 'gerade eben';
  if (diff < 3_600_000) return '${diff ~/ 60_000} min';
  if (diff < 86_400_000) return '${diff ~/ 3_600_000} std';
  return '${diff ~/ 86_400_000} tage';
}

/// Recompute status für eine vom server gelieferte device-liste anhand
/// von [now], damit "online → abwesend" ohne re-fetch sichtbar wird.
List<Map<String, dynamic>> refreshStatuses(
  List<Map<String, dynamic>> devices,
  int now, [
  DeviceThresholds? th,
]) {
  return devices.map((d) {
    final ls = d['lastSeen'];
    final lastSeen = ls is int ? ls : null;
    return {...d, 'status': liveStatus(lastSeen, now, th)};
  }).toList();
}

/// canRevoke: nur desktop-self, eigene session ausgenommen, token nötig
/// (mobile-clients bekommen keine fremden tokens ausgeliefert).
bool canRevoke(Map<String, dynamic>? device, Map<String, dynamic>? me) {
  if (device == null || me == null) return false;
  if (me['deviceType'] != 'desktop') return false;
  if (device['isMe'] == true) return false;
  final token = device['token'];
  if (token == null || (token is String && token.isEmpty)) return false;
  return true;
}
