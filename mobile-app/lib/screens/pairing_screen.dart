// Pairing-Screen: Server-URL eingeben, 6-stelligen Code vom Desktop pairen.
// Zwei Wege:
//   1. QR scannen → liest pgamma://pair?host=…&port=…&code=… und füllt aus
//   2. manuell: server-url + code eintippen
//
// Robust gegen schmale Phones: Buttons sind in einer Wrap statt Row, damit
// nichts overflowed (vorher: 1.7 px overflow auf 360 dp Geräten).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme.dart';
import '../sync_client.dart';
import 'qr_scan_screen.dart';
import 'account_login_screen.dart';

class PairingScreen extends StatefulWidget {
  /// Optional vorab-befüllter pgamma://pair?... Link (z.B. via Deep-Link).
  /// Wird in initState ausgewertet und ggf. direkt gepairt.
  final String? autoPairUri;
  const PairingScreen({super.key, this.autoPairUri});

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

enum _ServerStatus { unknown, testing, ok, fail }

class _PairingScreenState extends State<PairingScreen> {
  final _server = TextEditingController();
  final _code = TextEditingController();
  final _device = TextEditingController();
  bool _busy = false;
  bool _discovering = false;
  String? _error;
  String? _publicIpFallback;
  List<String> _altHosts = const [];
  _ServerStatus _serverStatus = _ServerStatus.unknown;

  @override
  void initState() {
    super.initState();
    _server.addListener(_onServerChange);
    if (widget.autoPairUri != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _applyPairUri(widget.autoPairUri!, autoPair: true);
      });
    }
  }

  void _onServerChange() {
    if (_serverStatus != _ServerStatus.unknown) {
      setState(() => _serverStatus = _ServerStatus.unknown);
    }
  }

  @override
  void dispose() {
    // Bugfix (audit): controllers + listener müssen disposed werden,
    // sonst leak bei jedem push/pop der screen
    _server.removeListener(_onServerChange);
    _server.dispose();
    _code.dispose();
    _device.dispose();
    super.dispose();
  }

  /// Liest pgamma://pair?host=…&port=…&code=… und befüllt die Felder.
  /// Bei [autoPair] = true startet das Pairing direkt nach dem Befüllen.
  Future<void> _applyPairUri(String raw, {bool autoPair = false}) async {
    Uri? uri;
    try {
      uri = Uri.parse(raw.trim());
    } catch (_) {}
    if (uri == null || uri.scheme != 'pgamma' || uri.host != 'pair') {
      setState(() => _error = 'qr-code unbekannt: kein pgamma://pair-link');
      return;
    }
    final host = uri.queryParameters['host']?.trim() ?? '';
    final port = uri.queryParameters['port']?.trim() ?? '7892';
    final code = uri.queryParameters['code']?.trim().toUpperCase() ?? '';
    final publicIp = uri.queryParameters['pub']?.trim() ?? '';
    // Alternative LAN-IPs (audit-fix): desktop bettet alle adapter-IPs ein,
    // damit mobile sie alle probieren kann (haupt-IP ist evtl. VPN-adapter).
    final hostsParam = uri.queryParameters['hosts']?.trim() ?? '';
    final altHosts = hostsParam.isEmpty
      ? <String>[]
      : hostsParam.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
    if (code.isEmpty) {
      setState(() => _error = 'qr-code unvollständig (code fehlt)');
      return;
    }
    // Erstmal jeden host probieren bis einer antwortet
    String chosenHost = host.isNotEmpty ? host : (publicIp.isNotEmpty ? publicIp : 'localhost');
    final candidates = [
      if (host.isNotEmpty) host,
      ...altHosts,
      if (publicIp.isNotEmpty) publicIp,
    ];
    for (final h in candidates) {
      if (await SyncClient.testServer('http://$h:$port')) {
        chosenHost = h;
        break;
      }
    }
    setState(() {
      _server.text = 'http://$chosenHost:$port';
      _code.text = code;
      _publicIpFallback = publicIp.isNotEmpty ? 'http://$publicIp:$port' : null;
      _altHosts = altHosts.map((h) => 'http://$h:$port').toList();
      _error = null;
      _serverStatus = _ServerStatus.unknown;
    });
    if (autoPair) {
      await _pair();
    }
  }

  Future<void> _testServer() async {
    setState(() { _serverStatus = _ServerStatus.testing; _error = null; });
    final ok = await SyncClient.testServer(_server.text.trim());
    if (!mounted) return;
    setState(() => _serverStatus = ok ? _ServerStatus.ok : _ServerStatus.fail);
  }

  Future<void> _discover() async {
    setState(() { _discovering = true; _error = null; _serverStatus = _ServerStatus.unknown; });
    final url = await SyncClient.discoverServer();
    if (!mounted) return;
    if (url != null) {
      _server.text = url;
      setState(() { _discovering = false; _serverStatus = _ServerStatus.ok; });
    } else {
      setState(() {
        _discovering = false;
        _error = 'kein server gefunden. trag die IP deines PCs manuell ein (im desktop unter „+ handy verbinden" sichtbar).';
      });
    }
  }

  Future<void> _scanQr() async {
    final result = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const QrScanScreen()),
    );
    if (result == null || !mounted) return;
    await _applyPairUri(result, autoPair: true);
  }

  Future<void> _pair() async {
    setState(() { _busy = true; _error = null; });
    final client = SyncClientScope.of(context, listen: false);
    try {
      final code = _code.text.trim().toUpperCase();
      if (code.length != 6) throw Exception('code muss 6 zeichen sein');
      var server = _server.text.trim();
      if (!server.startsWith('http')) throw Exception('server-url muss mit http(s):// beginnen');

      // Vor pair: server-erreichbarkeit testen + 4-stufiger fallback:
      //  1. originale URL (LAN oder QR-host) — z.B. 192.168.66.183 aus QR
      //  2. public-IP aus QR (internet-route, falls offene ports am router)
      //  3. localhost (für USB mit adb reverse)
      //  4. LAN-DISCOVERY: scannt ~300 typische heim-IPs (192.168.0/1/178/2.x)
      //     → wichtig wenn QR-IP auf VPN-/zerotier-adapter zeigt (haupt-bug)
      var reachable = await SyncClient.testServer(server);
      // Alt-LAN-IPs aus QR (verschiedene netzwerk-adapter) probieren
      if (!reachable) {
        for (final alt in _altHosts) {
          if (alt == server) continue;
          if (await SyncClient.testServer(alt)) {
            server = alt;
            if (mounted) setState(() => _server.text = server);
            reachable = true;
            break;
          }
        }
      }
      if (!reachable && _publicIpFallback != null && _publicIpFallback != server) {
        if (await SyncClient.testServer(_publicIpFallback!)) {
          server = _publicIpFallback!;
          if (mounted) setState(() => _server.text = server);
          reachable = true;
        }
      }
      if (!reachable) {
        final uri = Uri.tryParse(server);
        final port = uri?.port ?? 7892;
        final fallback = 'http://localhost:$port';
        if (fallback != server && await SyncClient.testServer(fallback)) {
          server = fallback;
          if (mounted) setState(() => _server.text = server);
          reachable = true;
        }
      }
      // Stufe 4: LAN-discovery automatisch starten wenn nichts gefunden.
      // Audit-fix: QR enthält oft VPN-adapter-IP (z.B. ZeroTier 192.168.66.x);
      // echtes heim-WLAN ist 192.168.0.x/1.x — der scan findet den server da.
      if (!reachable) {
        setState(() => _error = 'suche server im WLAN…');
        final uri = Uri.tryParse(server);
        final port = uri?.port ?? 7892;
        final found = await SyncClient.discoverServer(port: port);
        if (found != null) {
          server = found;
          if (mounted) setState(() => _server.text = server);
          reachable = true;
        }
      }
      if (!reachable) {
        throw Exception('server nicht erreichbar — gleiches WLAN? router-firewall aktiv?');
      }
      await client.pair(serverUrl: server, code: code, deviceName: _device.text.trim().isEmpty ? 'mobile' : _device.text.trim());
    } catch (e) {
      setState(() { _error = e.toString().replaceFirst('Exception: ', ''); });
    } finally {
      if (mounted) setState(() { _busy = false; });
    }
  }

  Widget _statusIcon() {
    switch (_serverStatus) {
      case _ServerStatus.testing:
        return const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2));
      case _ServerStatus.ok:
        return const Icon(Icons.check_circle, color: Color(0xFF1F8A5B), size: 18);
      case _ServerStatus.fail:
        return const Icon(Icons.cancel, color: pgDanger, size: 18);
      case _ServerStatus.unknown:
        return const SizedBox.shrink();
    }
  }

  String _statusText() {
    switch (_serverStatus) {
      case _ServerStatus.testing: return 'prüfe verbindung…';
      case _ServerStatus.ok:      return 'server erreichbar';
      case _ServerStatus.fail:    return 'server nicht erreichbar';
      case _ServerStatus.unknown: return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return Scaffold(
      backgroundColor: pgPaper,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(24, mq.padding.top + 16, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Image.asset('assets/Logo.png', width: 64, height: 64, fit: BoxFit.contain),
                  const PgChip('mobile', solid: true),
                ],
              ),
              const SizedBox(height: 28),
              Text('★ ProjectGamma',
                style: Theme.of(context).textTheme.headlineLarge!.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text('cloud-code · projekt-manager',
                style: TextStyle(color: pgInkSoft, fontSize: 13)),
              const SizedBox(height: 36),

              const PgEyebrow('schritt 01 / 02'),
              const SizedBox(height: 4),
              Text('mit desktop verbinden',
                style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              const Text(
                'der desktop zeigt einen QR-code + 6-stelligen pairing-code. '
                'scann den QR oder trag den code unten ein.',
                style: TextStyle(color: pgInkSoft, fontSize: 13, height: 1.5),
              ),
              const SizedBox(height: 16),

              // Großer prominenter QR-Scan-Button
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _scanQr,
                  icon: const Icon(Icons.qr_code_scanner, size: 20),
                  label: const Text('QR-code scannen', style: TextStyle(fontSize: 14)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: pgInk,
                    side: const BorderSide(color: pgInk, width: 2),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Row(children: const [
                Expanded(child: Divider(color: pgInkFaint, thickness: 1)),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 10),
                  child: Text('oder manuell',
                    style: TextStyle(fontSize: 11, color: pgInkFaint, fontFamily: 'monospace', letterSpacing: 1.2)),
                ),
                Expanded(child: Divider(color: pgInkFaint, thickness: 1)),
              ]),
              const SizedBox(height: 16),

              const PgEyebrow('server-url'),
              const SizedBox(height: 6),
              TextField(
                controller: _server,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                decoration: const InputDecoration(hintText: 'http://192.168.x.x:7892'),
                autocorrect: false,
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 8),
              // Wrap statt Row: kein Overflow auf 360-dp Phones.
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  OutlinedButton.icon(
                    onPressed: _serverStatus == _ServerStatus.testing ? null : _testServer,
                    icon: const Icon(Icons.network_check, size: 16),
                    label: const Text('testen'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: pgInk,
                      side: const BorderSide(color: pgInk, width: 1.5),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: _discovering ? null : _discover,
                    icon: _discovering
                        ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.search, size: 16),
                    label: const Text('server suchen'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: pgInk,
                      side: const BorderSide(color: pgInk, width: 1.5),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                  if (_serverStatus != _ServerStatus.unknown)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _statusIcon(),
                        const SizedBox(width: 4),
                        Text(_statusText(),
                          style: TextStyle(
                            fontSize: 11,
                            color: _serverStatus == _ServerStatus.ok ? const Color(0xFF1F8A5B) : pgInkSoft,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 16),

              const PgEyebrow('pairing-code'),
              const SizedBox(height: 6),
              TextField(
                controller: _code,
                textAlign: TextAlign.center,
                textCapitalization: TextCapitalization.characters,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
                  LengthLimitingTextInputFormatter(6),
                ],
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 28,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 8,
                ),
                decoration: const InputDecoration(hintText: '——————'),
              ),
              const SizedBox(height: 16),

              const PgEyebrow('gerätename'),
              const SizedBox(height: 6),
              TextField(
                controller: _device,
                decoration: const InputDecoration(hintText: 'z.B. samsung-s20'),
              ),
              const SizedBox(height: 24),

              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    border: Border.all(color: pgDanger, width: 1.5),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(_error!, style: const TextStyle(color: pgDanger, fontSize: 13)),
                ),
                const SizedBox(height: 14),
              ],

              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _busy ? null : _pair,
                  child: _busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: pgPaper, strokeWidth: 2))
                      : const Text('verbinden →'),
                ),
              ),
              const SizedBox(height: 18),
              // Account-Login als alternative (multi-user). Pair-flow oben
              // bleibt für device-pairing (legacy + offline-fall).
              Row(children: const [
                Expanded(child: Divider(color: pgInkFaint, thickness: 1)),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 10),
                  child: Text('oder',
                    style: TextStyle(fontSize: 11, color: pgInkFaint, fontFamily: 'monospace', letterSpacing: 1.2)),
                ),
                Expanded(child: Divider(color: pgInkFaint, thickness: 1)),
              ]),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () {
                    Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const AccountLoginScreen()),
                    );
                  },
                  icon: const Icon(Icons.person_outline, size: 18),
                  label: const Text('mit account anmelden'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: pgInk,
                    side: const BorderSide(color: pgInk, width: 2),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
              const SizedBox(height: 32),
              const Text(
                'tipp: standardmäßig läuft der server auf deinem pc unter port 7892.\n'
                '• im selben WLAN: trag deine PC-IP ein (siehe desktop „+ handy verbinden")\n'
                '• per USB mit "adb reverse tcp:7892 tcp:7892": nutze localhost\n'
                '• von außerhalb: portforwarding im router auf 7892 + öffentliche IP',
                style: TextStyle(color: pgInkFaint, fontSize: 11, height: 1.55, fontFamily: 'monospace'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
