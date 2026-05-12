// MainShell · BottomNav mit 5 Tabs: Projekt, Aufgaben, Regeln, Ideen, Cloud.
// Cloud-Tab vereint cc-control, devices, sync-verlauf, vorschläge, bugs in
// collapsable sections.
import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import '../widgets/connection_dot.dart';
import '../widgets/notifications_bell.dart';
import '../widgets/offline_queue_badge.dart';
import '../features/auto_update/auto_update_panel.dart';
import 'project_screen.dart';
import 'tasks_screen.dart';
import 'rules_screen.dart';
import 'ideas_screen.dart';
import 'cloud_screen.dart';
import 'team_screen.dart';
import 'project_picker.dart';
import 'settings_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});
  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _idx = 2; // Ideen ist häufigster mobile-task

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final p = client.activeProject;
    final tabs = const [
      _Tab('projekt',  Icons.folder_outlined,    ProjectScreen()),
      _Tab('aufgaben', Icons.check_box_outlined, TasksScreen()),
      _Tab('regeln',   Icons.gavel,              RulesScreen()),
      _Tab('ideen',    Icons.lightbulb_outline,  IdeasScreen()),
      _Tab('team',     Icons.groups_outlined,    TeamScreen()),
      _Tab('cloud',    Icons.bolt,               CloudScreen()),
    ];

    if (client.state == null) {
      return Scaffold(
        backgroundColor: pgPaper,
        body: SafeArea(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Image.asset('assets/Logo.png', width: 80, height: 80),
                const SizedBox(height: 24),
                const CircularProgressIndicator(color: pgInk),
                const SizedBox(height: 16),
                const Text('verbinde…', style: TextStyle(color: pgInkSoft)),
                const SizedBox(height: 24),
                if (client.lastError != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Text(client.lastError!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: pgDanger, fontSize: 12)),
                  ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => client.logout(),
                  child: const Text('neu pairen', style: TextStyle(color: pgInk, decoration: TextDecoration.underline)),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: pgPaper,
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(72),
        child: SafeArea(
          bottom: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 8, 12, 12),
            decoration: const BoxDecoration(
              color: pgPaper,
              border: Border(bottom: BorderSide(color: pgInk, width: 2)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: () => _pickProject(client),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(children: const [PgEyebrow('projekt'), SizedBox(width: 4), Icon(Icons.expand_more, size: 14, color: pgInkSoft)]),
                        const SizedBox(height: 2),
                        Text(
                          (p?['starred'] == true ? '★ ' : '') + (p?['name'] ?? '—').toString(),
                          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, height: 1.1),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ),
                const OfflineQueueBadge(),
                IconButton(
                  icon: const Icon(Icons.system_update, size: 20, color: pgInk),
                  tooltip: 'auto-update',
                  splashRadius: 18,
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const AutoUpdatePanel()),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.settings_outlined, size: 20, color: pgInk),
                  tooltip: 'einstellungen',
                  splashRadius: 18,
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const SettingsScreen()),
                  ),
                ),
                const NotificationsBell(),
                const SizedBox(width: 4),
                ConnectionDot(connected: client.connected),
              ],
            ),
          ),
        ),
      ),
      body: SafeArea(top: false, child: tabs[_idx].body),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: pgPaper,
          border: Border(top: BorderSide(color: pgInk, width: 2)),
        ),
        child: SafeArea(
          top: false,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              for (int i = 0; i < tabs.length; i++)
                Expanded(
                  child: InkWell(
                    onTap: () => setState(() => _idx = i),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 22, height: 22,
                            decoration: BoxDecoration(
                              color: _idx == i ? pgInk : Colors.transparent,
                              border: Border.all(color: pgInk, width: 1.5),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Icon(tabs[i].icon, size: 13, color: _idx == i ? pgPaper : pgInk),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            tabs[i].label,
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 9.5,
                              color: _idx == i ? pgInk : pgInkSoft,
                              fontWeight: _idx == i ? FontWeight.w600 : FontWeight.w400,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
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

