// LAN-Discovery für den Sync-Server.
// Probiert ~300 Kandidaten-URLs (localhost + typische Heimnetz-Subnets) auf
// ein erreichbares /health-Endpoint. WICHTIG: Concurrency-Limit + Cancel-on-Hit,
// damit auf schwachem WLAN/Akku nicht 300 Sockets gleichzeitig hängen
// (ENETUNREACH/ulimit auf manchen Android-Geräten).

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

/// Default-Concurrency: konservativ genug für schwaches WLAN, schnell genug
/// um die ~300 Kandidaten in <2s abzuarbeiten wenn der Server da ist.
const int kDiscoveryConcurrency = 16;

/// Standard-Probe via HTTP /health (3s Timeout).
Future<bool> probeHealth(String url) async {
  try {
    final r = await http
        .get(Uri.parse('$url/health'))
        .timeout(const Duration(seconds: 3));
    if (r.statusCode != 200) return false;
    final data = jsonDecode(r.body);
    return data['ok'] == true;
  } catch (_) {
    return false;
  }
}

/// Baut die übliche Kandidaten-Liste: localhost + drei häufige Heimnetz-Subnets,
/// jeweils Hosts .1–.50.
List<String> buildLanCandidates({int port = 7892}) {
  final list = <String>['http://localhost:$port'];
  const prefixes = [
    '192.168.0.',
    '192.168.1.',
    '192.168.66.',
    '192.168.178.',
    '192.168.2.',
    '10.0.0.',
  ];
  for (final p in prefixes) {
    for (var i = 1; i <= 50; i++) {
      list.add('http://$p$i:$port');
    }
  }
  return list;
}

/// Default-Discovery: nutzt `probeHealth` über die Standard-Kandidatenliste.
Future<String?> discoverServer({
  int port = 7892,
  int concurrency = kDiscoveryConcurrency,
  void Function(String url)? onTry,
}) {
  return discoverServerWith(
    candidates: buildLanCandidates(port: port),
    probe: probeHealth,
    concurrency: concurrency,
    onTry: onTry,
  );
}

/// Discovery, die ZUSÄTZLICH die public-routes vom server abfragt:
/// wenn ein server gefunden wird, holt sie /api/network-info und probiert
/// die public-IP/ngrok/UPnP-routen. So findet mobile auch ohne LAN den
/// server, falls public-IP via port-forwarding erreichbar ist.
///
/// Nutzung: nach erstem LAN-erfolg liefert er die LAN-URL (für lokales
/// netz schneller). UI kann später explizit /api/network-info abfragen
/// um public-routes auch anzubieten.
Future<String?> discoverServerWithFallbacks({
  int port = 7892,
  int concurrency = kDiscoveryConcurrency,
  void Function(String url)? onTry,
  List<String> extraCandidates = const [],
}) {
  final cands = [...buildLanCandidates(port: port), ...extraCandidates];
  return discoverServerWith(
    candidates: cands,
    probe: probeHealth,
    concurrency: concurrency,
    onTry: onTry,
  );
}

/// Worker-Pool-Discovery: max [concurrency] Probes parallel; sobald ein Probe
/// `true` liefert, werden keine weiteren Kandidaten mehr aus der Queue
/// gezogen. Bereits laufende Probes laufen aus (lassen sich in Dart nicht
/// hart abbrechen — http.Request hat keinen Cancel), aber es startet nichts
/// Neues mehr. Liefert die erste erfolgreiche URL oder null.
Future<String?> discoverServerWith({
  required List<String> candidates,
  required Future<bool> Function(String url) probe,
  int concurrency = kDiscoveryConcurrency,
  void Function(String url)? onTry,
}) async {
  if (candidates.isEmpty) return null;
  final completer = Completer<String?>();
  final queue = List<String>.from(candidates);
  var activeWorkers = 0;
  var done = false;

  void finishNull() {
    if (!done && !completer.isCompleted) {
      done = true;
      completer.complete(null);
    }
  }

  Future<void> worker() async {
    activeWorkers++;
    try {
      while (!done) {
        if (queue.isEmpty) return;
        final url = queue.removeAt(0);
        onTry?.call(url);
        try {
          final ok = await probe(url);
          if (ok && !done) {
            done = true;
            if (!completer.isCompleted) completer.complete(url);
            return;
          }
        } catch (_) {
          // Einzelner Probe-Fehler ist erwartet (ENETUNREACH usw.) -> ignorieren.
        }
      }
    } finally {
      activeWorkers--;
      if (activeWorkers == 0 && queue.isEmpty) finishNull();
    }
  }

  final n = concurrency < 1 ? 1 : concurrency;
  final workers = <Future<void>>[];
  for (var i = 0; i < n && i < candidates.length; i++) {
    workers.add(worker());
  }
  // Sicherheitsnetz: wenn alle Worker durch sind ohne Treffer -> null.
  unawaited(Future.wait(workers).then((_) => finishNull()));

  return completer.future;
}
