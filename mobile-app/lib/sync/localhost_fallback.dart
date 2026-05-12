// USB-only-Fallback: nach mehrfachen reconnect-fehlschlägen versucht der
// SyncClient localhost:<port> als alternative server-URL. Das funktioniert,
// wenn der Desktop via `adb reverse tcp:<port> tcp:<port>` einen tunnel hat
// (start.bat macht das). Damit braucht das Phone kein WLAN.
//
// Pure-Dart · keine flutter-/network-deps → unter dart:test ohne harness
// prüfbar.

/// Leitet aus einer beliebigen `http(s)://host:port` eine localhost-fallback-URL
/// ab. Wenn `serverUrl` bereits auf localhost/127.0.0.1 zeigt → null (kein
/// Fallback nötig).
String? deriveLocalhostFallback(String? serverUrl) {
  if (serverUrl == null || serverUrl.isEmpty) return null;
  final uri = Uri.tryParse(serverUrl);
  if (uri == null || !uri.hasScheme) return null;
  final host = uri.host.toLowerCase();
  if (host == 'localhost' || host == '127.0.0.1' || host == '::1') return null;
  final port = uri.hasPort ? uri.port : 7892;
  return '${uri.scheme}://localhost:$port';
}

/// Ab welchem reconnect-Versuch der localhost-fallback geprobed werden soll.
/// 1× sofort scheitern lassen — die meisten transienten Drops lösen sich
/// von allein. Erst ab versuch 2 lohnt der LAN→USB-Switch.
const int kLocalhostFallbackAfterAttempts = 2;

bool shouldTryLocalhostFallback(int reconnectAttempt) {
  return reconnectAttempt >= kLocalhostFallbackAfterAttempts;
}
