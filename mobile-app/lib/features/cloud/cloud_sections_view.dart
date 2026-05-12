import 'package:flutter/material.dart';
import '../../theme.dart';
import 'cloud_bug_row.dart';
import 'cloud_device_row.dart';
import 'cloud_history_row.dart';
import 'cloud_section.dart';
import 'cloud_suggestion_row.dart';

/// Bündelt die 4 collapsable sections (geräte/vorschläge/bugs/verlauf).
/// State (open-flags, sessions, callbacks) bleibt im parent (cloud_screen).
class CloudSectionsView extends StatelessWidget {
  final String projectId;
  final List<Map<String, dynamic>> sessions;
  final List<Map<String, dynamic>> suggestions;
  final List<Map<String, dynamic>> bugs;
  final List<Map<String, dynamic>> syncEntries;
  final int pendingSugg;
  final int pendingBugs;
  final bool devicesOpen;
  final bool suggOpen;
  final bool bugsOpen;
  final bool historyOpen;
  final VoidCallback onToggleDevices;
  final VoidCallback onToggleSugg;
  final VoidCallback onToggleBugs;
  final VoidCallback onToggleHistory;
  final VoidCallback onRefreshDevices;
  final VoidCallback onGenerateSugg;
  final VoidCallback onBughunt;
  final void Function(Map<String, dynamic> session) onRemoveDevice;

  const CloudSectionsView({
    super.key,
    required this.projectId,
    required this.sessions,
    required this.suggestions,
    required this.bugs,
    required this.syncEntries,
    required this.pendingSugg,
    required this.pendingBugs,
    required this.devicesOpen,
    required this.suggOpen,
    required this.bugsOpen,
    required this.historyOpen,
    required this.onToggleDevices,
    required this.onToggleSugg,
    required this.onToggleBugs,
    required this.onToggleHistory,
    required this.onRefreshDevices,
    required this.onGenerateSugg,
    required this.onBughunt,
    required this.onRemoveDevice,
  });

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      CloudSection(
        label: 'geräte', count: sessions.length, open: devicesOpen,
        onTap: onToggleDevices,
        trailing: IconButton(
          icon: const Icon(Icons.refresh, size: 16, color: pgInkSoft),
          onPressed: onRefreshDevices,
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 24, minHeight: 24),
        ),
        child: Column(children: [
          for (final s in sessions)
            CloudDeviceRow(session: s, onRemove: () => onRemoveDevice(s)),
        ]),
      ),
      CloudSection(
        label: 'vorschläge', count: pendingSugg, open: suggOpen,
        onTap: onToggleSugg,
        trailing: _TrailingBtn(
          icon: Icons.lightbulb_outline, label: 'generieren',
          onTap: onGenerateSugg),
        child: Column(children: [
          if (suggestions.isEmpty)
            const CloudEmpty('claude analysiert dein projekt + schlägt verbesserungen vor.')
          else
            for (final s in suggestions.take(8))
              CloudSuggestionRow(projectId: projectId, suggestion: s),
        ]),
      ),
      CloudSection(
        label: 'bugs', count: pendingBugs, open: bugsOpen,
        onTap: onToggleBugs,
        trailing: _TrailingBtn(
          icon: Icons.bug_report_outlined, label: 'hunt',
          onTap: onBughunt),
        child: Column(children: [
          if (bugs.isEmpty)
            const CloudEmpty('claude scannt source-files nach echten bugs.')
          else
            for (final b in bugs.take(8))
              CloudBugRow(projectId: projectId, bug: b),
        ]),
      ),
      CloudSection(
        label: 'verlauf', count: syncEntries.length, open: historyOpen,
        onTap: onToggleHistory,
        child: Column(children: [
          for (final e in syncEntries.take(15)) CloudHistoryRow(entry: e),
        ]),
      ),
    ]);
  }
}

class _TrailingBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _TrailingBtn({required this.icon, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) => TextButton.icon(
    onPressed: onTap,
    icon: Icon(icon, size: 14, color: pgInk),
    label: Text(label, style: const TextStyle(color: pgInk, fontSize: 11)),
    style: TextButton.styleFrom(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      minimumSize: Size.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap),
  );
}
