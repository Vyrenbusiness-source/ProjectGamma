// MainShell · BottomNav mit 4 Tabs: Projekt, Aufgaben, Ideen, Cloud.
// (Regeln + Team sind ins Projekt-Tab als „mitglieder verwalten" + „regeln"-
// row gewandert. 6 tabs waren zu eng auf 375px, touch-targets unter 48dp.)
// Cloud-Tab vereint cc-control, devices, sync-verlauf, vorschläge, bugs in
// collapsable sections.
import 'dart:async';
import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import '../widgets/connection_dot.dart';
import '../widgets/notifications_bell.dart';
import '../widgets/offline_queue_badge.dart';
import '../features/auto_update/auto_update_panel.dart';
import 'project_screen.dart';
import 'tasks_screen.dart';
import 'ideas_screen.dart';
import 'cloud_screen.dart';
import 'project_picker.dart';
import 'settings_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});
  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _idx = 2; // ideen (3. tab) ist häufigster mobile-task → default

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    // 4 tabs statt 6: regeln + team sind im projekt-tab erreichbar.
    // cloud-icon ist jetzt cloud (Icons.cloud_outlined) statt bolt → klarer.
    final tabs = const [
      _Tab('projekt',  Icons.folder_outlined,     ProjectScreen()),
      _Tab('aufgaben', Icons.check_box_outlined,  TasksScreen()),
      _Tab('ideen',    Icons.lightbulb_outline,   IdeasScreen()),
      _Tab('cloud',    Icons.cloud_outlined,      CloudScreen()),
    ];

    if (client.state == null) {
      return _ConnectingScreen(client: client);
    }

    return Scaffold(
      backgroundColor: pgPaper,
      // Größerer header (88px statt 72) erlaubt 2-zeiligen titel ohne cutoff.
      // Sekundäre actions (auto-update, settings) ins overflow-menu — damit
      // bleibt rechts platz für status (offline-badge, bell, connection-dot)
      // und der titel hat genug raum.
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(88),
        child: SafeArea(
          bottom: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 8, 8, 12),
            decoration: const BoxDecoration(
              color: pgPaper,
              border: Border(bottom: BorderSide(color: pgInk, width: 2)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: () => _pickProject(client),
                    behavior: HitTestBehavior.opaque,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(children: const [
                          PgEyebrow('projekt'),
                          SizedBox(width: 4),
                          Icon(Icons.expand_more, size: 14, color: pgInkSoft)
                        ]),
                        const SizedBox(height: 2),
                        Text(
                          (p?['starred'] == true ? '★ ' : '') + (p?['name'] ?? '—').toString(),
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, height: 1.15),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                const OfflineQueueBadge(),
                const NotificationsBell(),
                const SizedBox(width: 2),
                ConnectionDot(connected: client.connected),
                // Overflow-menu für sekundäre actions
                PopupMenuButton<String>(
                  icon: const Icon(Icons.more_vert, size: 22, color: pgInk),
                  tooltip: 'mehr',
                  color: pgPaper,
                  shape: RoundedRectangleBorder(
                    side: const BorderSide(color: pgInk, width: 1.5),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  onSelected: (v) {
                    if (v == 'update') {
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AutoUpdatePanel()));
                    } else if (v == 'settings') {
                      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SettingsScreen()));
                    }
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: 'update', child: Row(children: [
                      Icon(Icons.system_update, size: 18, color: pgInk),
                      SizedBox(width: 10),
                      Text('auto-update', style: TextStyle(color: pgInk)),
                    ])),
                    const PopupMenuItem(value: 'settings', child: Row(children: [
                      Icon(Icons.settings_outlined, size: 18, color: pgInk),
                      SizedBox(width: 10),
                      Text('einstellungen', style: TextStyle(color: pgInk)),
                    ])),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
      body: SafeArea(top: false, child: tabs[_idx].body),
      bottomNavigationBar: _buildBottomNav(tabs, p),
    );
  }

  Widget _buildBottomNav(List<_Tab> tabs, Map<String, dynamic>? p) {
    // pendingQuestion → cloud-tab highlighten (analog zum desktop).
    // Server speichert es als String (siehe SET_PENDING_QUESTION mutation).
    final pq = p == null ? null : p['pendingQuestion'];
    final ccPending = pq is String && pq.trim().isNotEmpty;
    final items = <Widget>[];
    for (int i = 0; i < tabs.length; i++) {
      final tab = tabs[i];
      final active = _idx == i;
      final pending = tab.label == 'cloud' && ccPending && !active;
      items.add(Expanded(
        child: InkWell(
          onTap: () => setState(() => _idx = i),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _TabIcon(tab: tab, active: active, pending: pending),
                const SizedBox(height: 3),
                Text(
                  tab.label,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 9.5,
                    color: pending
                      ? const Color(0xFFCC8800)
                      : (active ? pgInk : pgInkSoft),
                    fontWeight: (active || pending) ? FontWeight.w600 : FontWeight.w400,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ));
    }
    return Container(
      decoration: const BoxDecoration(
        color: pgPaper,
        border: Border(top: BorderSide(color: pgInk, width: 2)),
      ),
      child: SafeArea(
        top: false,
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: items),
      ),
    );
  }

  void _pickProject(SyncClient client) async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: pgPaper,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
      builder: (_) => ProjectPicker(),
    );
    if (selected != null) await client.setActiveProject(selected);
  }
}

class _Tab {
  final String label;
  final IconData icon;
  final Widget body;
  const _Tab(this.label, this.icon, this.body);
}

// Verbinde-screen mit timeout-feedback: nach 8s erscheint hinweis dass etwas
// nicht stimmt, plus prominenter "neu pairen"-button. Vorher konnte user im
// endlosen "verbinde…" hängen ohne klares signal.
class _ConnectingScreen extends StatefulWidget {
  final SyncClient client;
  const _ConnectingScreen({required this.client});
  @override
  State<_ConnectingScreen> createState() => _ConnectingScreenState();
}

class _ConnectingScreenState extends State<_ConnectingScreen> {
  Timer? _slowTimer;
  bool _slow = false;
  bool _loggingOut = false;

  @override
  void initState() {
    super.initState();
    _slowTimer = Timer(const Duration(seconds: 8), () {
      if (mounted) setState(() => _slow = true);
    });
  }

  @override
  void dispose() {
    _slowTimer?.cancel();
    super.dispose();
  }

  Future<void> _retry() async {
    if (!widget.client.hasSession) return;
    setState(() { _slow = false; });
    _slowTimer?.cancel();
    _slowTimer = Timer(const Duration(seconds: 8), () {
      if (mounted) setState(() => _slow = true);
    });
    await widget.client.connect();
  }

  Future<void> _resetPairing() async {
    if (_loggingOut) return;
    setState(() => _loggingOut = true);
    await widget.client.logout();
    // notifyListeners triggert root-rebuild → PairingScreen rendert.
  }

  @override
  Widget build(BuildContext context) {
    final err = widget.client.lastError;
    return Scaffold(
      backgroundColor: pgPaper,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Image.asset('assets/Logo.png', width: 80, height: 80),
                const SizedBox(height: 24),
                if (!_slow) ...[
                  const CircularProgressIndicator(color: pgInk),
                  const SizedBox(height: 16),
                  const Text('verbinde…', style: TextStyle(color: pgInkSoft)),
                ] else ...[
                  const Icon(Icons.signal_wifi_off, size: 36, color: pgDanger),
                  const SizedBox(height: 12),
                  const Text('server nicht erreichbar',
                    style: TextStyle(fontSize: 16, color: pgInk, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: Text(
                      widget.client.serverUrl != null
                        ? 'Versuche Verbindung zu ${widget.client.serverUrl}'
                        : 'Keine Server-URL gesetzt',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 12, color: pgInkSoft),
                    ),
                  ),
                ],
                if (err != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      border: Border.all(color: pgDanger, width: 1.5),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(err,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: pgDanger, fontSize: 11.5)),
                  ),
                ],
                const SizedBox(height: 24),
                if (_slow)
                  ElevatedButton.icon(
                    onPressed: _retry,
                    icon: const Icon(Icons.refresh, size: 18),
                    label: const Text('erneut versuchen'),
                  ),
                const SizedBox(height: 8),
                TextButton.icon(
                  onPressed: _loggingOut ? null : _resetPairing,
                  icon: _loggingOut
                    ? const SizedBox(width: 14, height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2, color: pgInk))
                    : const Icon(Icons.logout, size: 18, color: pgInk),
                  label: Text(_loggingOut ? 'beende session…' : 'neu pairen',
                    style: const TextStyle(color: pgInk, decoration: TextDecoration.underline)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// Tab-icon mit optionalem ❓-pending-dot rechts oben.
class _TabIcon extends StatelessWidget {
  final _Tab tab;
  final bool active;
  final bool pending;
  const _TabIcon({required this.tab, required this.active, required this.pending});
  @override
  Widget build(BuildContext context) {
    final borderColor = pending ? const Color(0xFFCC8800) : pgInk;
    final borderWidth = pending ? 2.0 : 1.5;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          width: 22, height: 22,
          decoration: BoxDecoration(
            color: active ? pgInk : Colors.transparent,
            border: Border.all(color: borderColor, width: borderWidth),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Icon(tab.icon, size: 13, color: active ? pgPaper : pgInk),
        ),
        if (pending)
          Positioned(
            top: -4, right: -4,
            child: Container(
              width: 12, height: 12, alignment: Alignment.center,
              decoration: const BoxDecoration(
                color: Color(0xFFCC8800),
                shape: BoxShape.circle,
              ),
              child: const Text('?',
                style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w700)),
            ),
          ),
      ],
    );
  }
}

