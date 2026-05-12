// ProjectGamma · Mobile · Einstiegspunkt
// Schalter zwischen Pairing-Screen und Haupt-Shell anhand gespeicherter Session.
//
// Deep-Link-Support: wenn die App via `pgamma://pair?host=…&port=…&code=…`
// geöffnet wird (z.B. weil der User den QR aus dem Desktop-Pair-Modal mit der
// System-Kamera scannt), springt der RootGate direkt auf einen
// PairingScreen mit vorausgefülltem Code + Auto-Pair.

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:app_links/app_links.dart';
import 'theme.dart';
import 'sync_client.dart';
import 'screens/pairing_screen.dart';
import 'screens/main_shell.dart';
import 'features/notifications/system_push.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
  ));
  final client = SyncClient();
  await client.loadSession();
  // Plugin async initialisieren — App-Start blockiert nicht falls die
  // Notifications-Permission noch nicht erteilt ist.
  unawaited(SystemPush.instance.init());
  runApp(ProjectGammaApp(client: client));
}

class ProjectGammaApp extends StatelessWidget {
  final SyncClient client;
  const ProjectGammaApp({super.key, required this.client});

  @override
  Widget build(BuildContext context) {
    // Bugfix: SyncClientScope MUSS über dem MaterialApp/Navigator stehen,
    // sonst sind modale bottom-sheets + dialoge im sibling-tree und finden
    // den scope nicht (assertion 'scope != null' bei project-wechsel).
    return SyncClientScope(
      client: client,
      child: MaterialApp(
        title: 'ProjectGamma',
        debugShowCheckedModeBanner: false,
        theme: pgTheme(),
        home: const _RootGate(),
      ),
    );
  }
}

class _RootGate extends StatefulWidget {
  const _RootGate();
  @override
  State<_RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<_RootGate> {
  late SyncClient _client;
  late final AppLinks _appLinks;
  StreamSubscription<Uri>? _linkSub;
  String? _pendingPairUri;

  @override
  void initState() {
    super.initState();
    _appLinks = AppLinks();
    _initDeepLinks();
  }

  Future<void> _initDeepLinks() async {
    // Cold-start: App wurde direkt durch Deep-Link gestartet.
    try {
      final initial = await _appLinks.getInitialLink();
      if (initial != null) _handleUri(initial);
    } catch (_) {}
    // Warm-state: App lief schon, neuer Link kommt rein.
    _linkSub = _appLinks.uriLinkStream.listen(
      _handleUri,
      onError: (_) {},
    );
  }

  void _handleUri(Uri uri) {
    if (uri.scheme == 'pgamma' && uri.host == 'pair') {
      if (mounted) setState(() => _pendingPairUri = uri.toString());
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _client = SyncClientScope.of(context, listen: false);
    _client.addListener(_onChange);
    if (_client.hasSession && !_client.connected) _client.connect();
  }

  void _onChange() {
    if (!mounted) return;
    // Bugfix (audit): wenn das pairing per deep-link erfolgreich war, hat
    // _client.hasSession==true. _pendingPairUri muss gecleared werden, sonst
    // bleibt der user auf der PairingScreen hängen.
    if (_pendingPairUri != null && _client.hasSession) {
      setState(() => _pendingPairUri = null);
    } else {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    _client.removeListener(_onChange);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    // Pending Pair-URI hat Vorrang: zwingt PairingScreen auch wenn schon
    // eine Session existiert (User scannt evtl. einen neuen Desktop).
    if (_pendingPairUri != null) {
      return PairingScreen(autoPairUri: _pendingPairUri);
    }
    if (!client.hasSession) return const PairingScreen();
    return const MainShell();
  }
}
