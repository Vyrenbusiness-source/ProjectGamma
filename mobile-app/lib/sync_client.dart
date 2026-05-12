// SyncClient · HTTP-Pairing + WebSocket-Live-Sync.
// State ist eine Map<String,dynamic> (Server liefert es so). Jedes STATE-Frame
// vom Server ersetzt den Local-State und triggert notifyListeners().

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/io.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'sync/lan_discovery.dart' as lan;
import 'sync/localhost_fallback.dart';
import 'features/notifications/notifications_inbox.dart';
import 'features/notifications/system_push.dart';
import 'features/offline_queue/offline_queue.dart';
import 'features/offline_queue/offline_queue_sender.dart';
import 'features/sync_heartbeat/heartbeat.dart';

class SyncClient extends ChangeNotifier {
  String? _serverUrl; // z.B. http://192.168.1.42:7892
  String? _token;
  String? _deviceName;
  Map<String, dynamic>? state;
  String? activeProjectId;
  bool _connected = false;
  String? lastError;
  WebSocketChannel? _ws;
  HeartbeatMonitor? _heartbeat;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;
  final NotificationsInbox notifications = NotificationsInbox(max: 50);
  final OfflineQueue offlineQueue = OfflineQueue(max: 100);

  bool get hasSession => _token != null && _serverUrl != null;
  bool get connected => _connected;
  String? get serverUrl => _serverUrl;
  String? get deviceName => _deviceName;
  /// Auth-token (Bearer) für authentifizierte requests aus feature-modulen
  /// (z.b. auto_update_panel). Nur lesen, niemals von extern setzen.
  String? get authToken => _token;

  /// Convenience-getter für http-headers mit Bearer-token. Liefert
  /// `{authorization: Bearer <token>}` wenn token gesetzt, sonst leeres map.
  Map<String, String> get authHeader =>
      _token != null ? {'authorization': 'Bearer $_token'} : const {};

  /// User-email wenn account-login (sonst null bei pair-token).
  /// Wird beim register/login gecached. Genutzt z.B. für RSVP-comparison.
  String? get userEmail => _userEmail;
  String? _userEmail;

  /// Public wrapper für protected `notifyListeners()` — wird vom UI nach
  /// inbox.markRead/clear/drop aufgerufen, damit der Bell-Badge sich neu zeichnet.
  void notifyAll() => notifyListeners();

  Future<void> loadSession() async {
    final prefs = await SharedPreferences.getInstance();
    _serverUrl = prefs.getString('serverUrl');
    _token = prefs.getString('token');
    _deviceName = prefs.getString('deviceName');
    activeProjectId = prefs.getString('activeProjectId');
    _loadOfflineQueue(prefs);
    notifyListeners();
  }

  void _loadOfflineQueue(SharedPreferences prefs) {
    final raw = prefs.getString('offlineQueue');
    if (raw == null) return;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      final restored = OfflineQueue.fromJson(j);
      for (final i in restored.list.reversed) {
        offlineQueue.enqueue(type: i.type, payload: i.payload);
      }
    } catch (_) {}
  }

  Future<void> _saveOfflineQueue() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('offlineQueue', jsonEncode(offlineQueue.toJson()));
  }

  Future<void> _saveSession() async {
    final prefs = await SharedPreferences.getInstance();
    if (_serverUrl != null) await prefs.setString('serverUrl', _serverUrl!);
    if (_token != null) await prefs.setString('token', _token!);
    if (_deviceName != null) await prefs.setString('deviceName', _deviceName!);
    if (activeProjectId != null) await prefs.setString('activeProjectId', activeProjectId!);
  }

  Future<void> setActiveProject(String id) async {
    activeProjectId = id;
    await _saveSession();
    notifyListeners();
  }

  /// Health-Check eines Servers. Liefert true wenn /health erreichbar.
  static Future<bool> testServer(String url) => lan.probeHealth(url);

  /// Sucht den Sync-Server im LAN. Concurrency-limitiert (siehe lan_discovery),
  /// damit auf schwachem WLAN/Akku nicht hunderte Sockets gleichzeitig hängen.
  static Future<String?> discoverServer({int port = 7892, void Function(String url)? onTry}) =>
      lan.discoverServer(port: port, onTry: onTry);

  /// Account-Login (multi-user schicht 1+2). Anders als pair(), liefert
  /// ein user-token (sqlite-backed), das memberships erzwingt — der client
  /// sieht im STATE nur projekte, in denen der user mitglied ist.
  Future<void> loginWithAccount({
    required String serverUrl,
    required String email,
    required String password,
    String? deviceName,
  }) async {
    await _authPost(
      serverUrl: serverUrl,
      path: '/api/auth/login',
      body: {'email': email, 'password': password},
      deviceName: deviceName ?? email,
    );
  }

  /// Account-Register + auto-login. Erster registrierter user wird OWNER
  /// aller bestehenden Projekte (server-bootstrap).
  Future<void> registerAccount({
    required String serverUrl,
    required String email,
    required String password,
    String? deviceName,
  }) async {
    await _authPost(
      serverUrl: serverUrl,
      path: '/api/auth/register',
      body: {'email': email, 'password': password},
      deviceName: deviceName ?? email,
    );
  }

  Future<void> _authPost({
    required String serverUrl,
    required String path,
    required Map<String, dynamic> body,
    required String deviceName,
  }) async {
    lastError = null;
    final res = await http.post(
      Uri.parse('$serverUrl$path'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode(body),
    ).timeout(const Duration(seconds: 10));
    if (res.statusCode != 200 && res.statusCode != 201) {
      String msg;
      try { msg = (jsonDecode(res.body)['error'] ?? 'fehler').toString(); }
      catch (_) { msg = 'fehler ${res.statusCode}'; }
      throw Exception(msg);
    }
    final data = jsonDecode(res.body);
    _serverUrl = serverUrl;
    _token = data['token'];
    _deviceName = deviceName;
    // Bugfix (audit): user-email cachen für RSVP/author-vergleich
    _userEmail = (data['user'] is Map ? (data['user'] as Map)['email']?.toString() : null);
    await _saveSession();
    notifyListeners();
    await connect();
  }

  /// Pairing: ruft /api/pair/claim auf, speichert Token bei Erfolg.
  Future<void> pair({
    required String serverUrl,
    required String code,
    required String deviceName,
  }) async {
    lastError = null;
    final url = Uri.parse('$serverUrl/api/pair/claim');
    final res = await http.post(
      url,
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'code': code, 'deviceName': deviceName, 'deviceType': 'mobile'}),
    ).timeout(const Duration(seconds: 8));
    if (res.statusCode != 200) {
      String msg;
      try { msg = (jsonDecode(res.body)['error'] ?? 'fehler').toString(); }
      catch (_) { msg = 'fehler ${res.statusCode}'; }
      throw Exception(msg);
    }
    final data = jsonDecode(res.body);
    _serverUrl = serverUrl;
    _token = data['token'];
    _deviceName = deviceName;
    await _saveSession();
    notifyListeners();
    await connect();
  }

  Future<void> connect() async {
    if (_token == null || _serverUrl == null) return;
    await disconnect();

    // KEIN HTTP-401-Probe vor connect — der ist zu aggressiv und hat das Phone
    // bei jedem Server-Restart oder kurzzeitiger Erreichbarkeitslücke ausgeloggt.
    // Stattdessen: WS direkt versuchen. Echtes Logout passiert nur wenn:
    //   - Server explizit REVOKED-Frame schickt (Device wurde entfernt)
    //   - User klickt manuell „neu pairen"

    final wsUrl = _serverUrl!.replaceFirst(RegExp(r'^http'), 'ws') + '/ws?token=$_token';
    try {
      _ws = IOWebSocketChannel.connect(Uri.parse(wsUrl), pingInterval: const Duration(seconds: 30));
      _ws!.stream.listen(
        _onMessage,
        onError: (e) => _onClose('error: $e'),
        onDone: () => _onClose('closed'),
      );
      _connected = true;
      _reconnectAttempt = 0;
      lastError = null;
      _heartbeat?.stop();
      _heartbeat = HeartbeatMonitor(
        onPing: () => _send({'type': 'PING'}),
        // kein PONG → ws schließen, _onClose triggert reconnect
        onTimeout: () { try { _ws?.sink.close(); } catch (_) {} },
      )..start();
      notifyListeners();
      // Reconnect: pending dispatches als optimistisches UI nachfahren.
      // ignore: unawaited_futures
      _drainOfflineQueue();
    } catch (e) {
      lastError = 'verbindungsfehler: $e';
      _connected = false;
      _scheduleReconnect();
      notifyListeners();
    }
  }

  Future<void> disconnect() async {
    _heartbeat?.stop();
    _heartbeat = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    try { await _ws?.sink.close(); } catch (_) {}
    _ws = null;
    _connected = false;
  }

  Future<void> logout() async {
    await disconnect();
    _serverUrl = null;
    _token = null;
    _deviceName = null;
    activeProjectId = null;
    state = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('serverUrl');
    await prefs.remove('token');
    await prefs.remove('deviceName');
    await prefs.remove('activeProjectId');
    notifyListeners();
  }

  void _onMessage(dynamic raw) {
    try {
      final msg = jsonDecode(raw is String ? raw : raw.toString()) as Map<String, dynamic>;
      switch (msg['type']) {
        case 'PONG':
          _heartbeat?.notePong();
          break;
        case 'STATE':
          state = (msg['state'] as Map).cast<String, dynamic>();
          // Aktivem Projekt einen Default geben
          if (activeProjectId == null) {
            final projects = state!['projects'] as List?;
            if (projects != null && projects.isNotEmpty) {
              activeProjectId = projects.first['id'];
            }
          }
          notifyListeners();
          break;
        case 'ERROR':
          lastError = msg['error']?.toString();
          notifyListeners();
          break;
        case 'PUSH_NOTIFICATION':
          final n = msg['notification'];
          if (notifications.push(n)) {
            notifyListeners();
            if (n is Map) {
              // best-effort: System-Push parallel zur Inbox.
              // Fehler werden im SystemPush selbst geschluckt.
              SystemPush.instance.show(Map<String, dynamic>.from(n));
            }
          }
          break;
        case 'REVOKED':
          // Server hat dieses Gerät vom Desktop aus entfernt → lokal ausloggen
          lastError = 'verbindung vom desktop getrennt';
          logout();
          break;
      }
    } catch (e) {
      // ignore malformed
    }
  }

  void _onClose(String reason) {
    _connected = false;
    _ws = null;
    _heartbeat?.stop();
    _heartbeat = null;
    notifyListeners();
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_token == null) return;
    _reconnectAttempt += 1;
    final delay = computeBackoff(
      _reconnectAttempt,
      base: const Duration(seconds: 1),
      factor: 1.6,
      max: const Duration(seconds: 30),
      jitter: 0.2,
    );
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () async {
      if (_token == null) return;
      // USB-only-Fallback: nach mehrfach gescheitertem reconnect prüfen, ob
      // der Server unter localhost erreichbar ist (adb-reverse-tunnel).
      if (shouldTryLocalhostFallback(_reconnectAttempt)) {
        await _maybeSwitchToLocalhost();
      }
      // Inverse-Fallback (Bugfix): server-URL ist localhost, aber WLAN ist
      // jetzt da (kein USB mehr) → LAN-discovery starten und auf neue IP
      // umsteigen wenn gefunden.
      if (_reconnectAttempt >= 3 && _isLocalhostUrl(_serverUrl)) {
        await _maybeRediscoverLan();
      }
      await connect();
    });
  }

  bool _isLocalhostUrl(String? url) {
    if (url == null) return false;
    final u = Uri.tryParse(url);
    if (u == null) return false;
    final h = u.host.toLowerCase();
    return h == 'localhost' || h == '127.0.0.1' || h == '::1';
  }

  /// Suche neuen server im LAN, swap server-URL wenn gefunden.
  Future<void> _maybeRediscoverLan() async {
    try {
      final port = Uri.tryParse(_serverUrl ?? '')?.port ?? 7892;
      final found = await lan.discoverServer(port: port);
      if (found != null && !_isLocalhostUrl(found)) {
        _serverUrl = found;
        lastError = 'auf LAN-server umgestiegen: $found';
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('serverUrl', found);
        notifyListeners();
      }
    } catch (_) { /* best-effort */ }
  }

  /// Probiert localhost:<port> als alternative server-URL und übernimmt sie,
  /// wenn /health respondet. Best-effort, kein throw nach außen.
  Future<void> _maybeSwitchToLocalhost() async {
    final fallback = deriveLocalhostFallback(_serverUrl);
    if (fallback == null) return;
    try {
      final r = await http
          .get(Uri.parse('$fallback/health'))
          .timeout(const Duration(seconds: 2));
      if (r.statusCode != 200) return;
      final body = jsonDecode(r.body);
      if (body is! Map || body['ok'] != true) return;
      // Localhost antwortet — swap.
      _serverUrl = fallback;
      lastError = 'fallback auf localhost (USB-tunnel)';
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('serverUrl', fallback);
      notifyListeners();
    } catch (_) {
      // localhost nicht erreichbar — bleibt bei LAN-URL, nächster retry probiert wieder
    }
  }

  void _send(Map<String, dynamic> obj) {
    final ws = _ws;
    if (ws == null) return;
    try { ws.sink.add(jsonEncode(obj)); } catch (_) {}
  }

  /// Mutation an Server schicken. Server broadcastet das neue STATE zurück.
  /// Falls offline → in [offlineQueue] enqueuen für optimistisches UI und
  /// beim nächsten Connect via drainPending wiederholen.
  Future<void> mutate(String type, Map<String, dynamic> payload) async {
    final mut = {'type': type, 'payload': payload};
    if (_connected && _ws != null) {
      _send({'type': 'MUT', 'mutation': mut});
      return;
    }
    offlineQueue.enqueue(type: type, payload: payload);
    await _saveOfflineQueue();
    notifyListeners();
  }

  /// Pending-Queue an Server senden (Reconnect-Flow). Pure-Logik in
  /// [drainAndSend] ausgelagert, damit ohne widget-tester testbar.
  Future<void> _drainOfflineQueue() async {
    if (offlineQueue.pending.isEmpty) return;
    await drainAndSend(
      queue: offlineQueue,
      sender: (item) async {
        if (_connected && _ws != null) {
          _send({'type': 'MUT', 'mutation': {'type': item.type, 'payload': item.payload}});
          return true;
        }
        return false;
      },
    );
    await _saveOfflineQueue();
    notifyListeners();
  }

  /// UI-trigger: einzelnes failed-item erneut versuchen.
  Future<void> retryQueueItem(String id) async {
    offlineQueue.retry(id);
    await _saveOfflineQueue();
    notifyListeners();
    if (_connected) await _drainOfflineQueue();
  }

  /// UI-trigger: item verwerfen.
  Future<void> dropQueueItem(String id) async {
    offlineQueue.drop(id);
    await _saveOfflineQueue();
    notifyListeners();
  }

  /// Cloud-Code starten (POST /api/cc/run).
  /// Timeout ist großzügig (30s), weil der Server beim Spawn auch IDE-Pfade
  /// prüft + ggf. autoPumpTick parallel läuft. Bei TimeoutException läuft der
  /// Run i.d.R. trotzdem — der State kommt dann via WS-STATE-Frame.
  Future<void> ccRun({required String projectId, String? taskId, String? prompt}) async {
    if (_serverUrl == null || _token == null) throw Exception('nicht verbunden');
    final r = await http.post(
      Uri.parse('$_serverUrl/api/cc/run'),
      headers: {'content-type': 'application/json', 'authorization': 'Bearer $_token'},
      body: jsonEncode({'projectId': projectId, 'taskId': taskId, 'prompt': prompt}),
    ).timeout(const Duration(seconds: 30));
    if (r.statusCode != 200) {
      String msg;
      try { msg = (jsonDecode(r.body)['error'] ?? 'fehler').toString(); }
      catch (_) { msg = 'fehler ${r.statusCode}'; }
      throw Exception(msg);
    }
  }

  Future<void> ccStop(String projectId) async {
    if (_serverUrl == null || _token == null) throw Exception('nicht verbunden');
    await http.post(
      Uri.parse('$_serverUrl/api/cc/stop'),
      headers: {'content-type': 'application/json', 'authorization': 'Bearer $_token'},
      body: jsonEncode({'projectId': projectId}),
    ).timeout(const Duration(seconds: 10));
  }

  Future<void> ccSuggest(String projectId) async {
    if (_serverUrl == null || _token == null) throw Exception('nicht verbunden');
    await http.post(
      Uri.parse('$_serverUrl/api/cc/suggest'),
      headers: {'content-type': 'application/json', 'authorization': 'Bearer $_token'},
      body: jsonEncode({'projectId': projectId}),
    ).timeout(const Duration(seconds: 30));
  }

  Future<void> ccBughunt(String projectId) async {
    if (_serverUrl == null || _token == null) throw Exception('nicht verbunden');
    await http.post(
      Uri.parse('$_serverUrl/api/cc/bughunt'),
      headers: {'content-type': 'application/json', 'authorization': 'Bearer $_token'},
      body: jsonEncode({'projectId': projectId}),
    ).timeout(const Duration(seconds: 30));
  }

  Future<List<Map<String, dynamic>>> listSessions() async {
    if (_serverUrl == null || _token == null) return [];
    try {
      final r = await http.get(
        Uri.parse('$_serverUrl/api/sessions'),
        headers: {'authorization': 'Bearer $_token'},
      ).timeout(const Duration(seconds: 4));
      if (r.statusCode != 200) return [];
      final data = jsonDecode(r.body);
      return ((data['sessions'] as List?) ?? const []).cast<Map<String, dynamic>>();
    } catch (_) { return []; }
  }

  Future<void> removeSession(String token) async {
    if (_serverUrl == null || _token == null) return;
    await http.delete(
      Uri.parse('$_serverUrl/api/sessions/$token'),
      headers: {'authorization': 'Bearer $_token'},
    ).timeout(const Duration(seconds: 4));
  }

  // ─── Convenience accessors ────────────────────────────
  List<Map<String, dynamic>> get projects {
    final list = (state?['projects'] as List?) ?? const [];
    return list.cast<Map<String, dynamic>>();
  }

  Map<String, dynamic>? get activeProject {
    if (state == null) return null;
    final list = projects;
    if (list.isEmpty) return null;
    final id = activeProjectId;
    return list.firstWhere(
      (p) => p['id'] == id,
      orElse: () => list.first,
    );
  }

  List<Map<String, dynamic>> get syncLog {
    final list = (state?['syncLog'] as List?) ?? const [];
    return list.cast<Map<String, dynamic>>();
  }
}

/// InheritedNotifier-Style Scope, damit Widgets per .of() rebuild bei Updates.
class SyncClientScope extends InheritedNotifier<SyncClient> {
  const SyncClientScope({super.key, required SyncClient client, required super.child})
      : super(notifier: client);

  static SyncClient of(BuildContext context, {bool listen = true}) {
    final scope = listen
        ? context.dependOnInheritedWidgetOfExactType<SyncClientScope>()
        : context.getInheritedWidgetOfExactType<SyncClientScope>();
    assert(scope != null, 'No SyncClientScope found');
    return scope!.notifier!;
  }
}
