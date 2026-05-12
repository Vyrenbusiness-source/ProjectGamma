import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';
import 'new_project_screen.dart';

class ProjectPicker extends StatelessWidget {
  const ProjectPicker({super.key});

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final projects = client.projects;
    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 40, height: 4, margin: const EdgeInsets.symmetric(vertical: 8),
            alignment: Alignment.center,
            child: Container(width: 40, height: 4, color: pgInkFaint),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: PgEyebrow('projekt wählen'),
          ),
          const Divider(height: 0, color: pgInk, thickness: 2),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 380),
            child: ListView.separated(
              shrinkWrap: true,
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: projects.length,
              separatorBuilder: (_, __) => const Divider(height: 0, color: pgInkFaint, thickness: 1, indent: 20, endIndent: 20),
              itemBuilder: (_, i) {
                final p = projects[i];
                final tasks = (p['tasks'] as List?) ?? const [];
                final open = tasks.where((t) => t['done'] != true).length;
                final isActive = p['id'] == client.activeProjectId;
                return ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                  leading: Text(
                    p['starred'] == true ? '★' : '☆',
                    style: TextStyle(fontSize: 22, color: isActive ? pgInk : pgInkSoft),
                  ),
                  title: Text(
                    p['name']?.toString() ?? '—',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
                  subtitle: Text(
                    '$open offen · ${(p['ideas'] as List?)?.length ?? 0} ideen',
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: pgInkSoft),
                  ),
                  trailing: isActive
                      ? const Icon(Icons.check, color: pgInk, size: 20)
                      : const Icon(Icons.chevron_right, color: pgInkFaint),
                  onTap: () => Navigator.pop(context, p['id'] as String),
                );
              },
            ),
          ),
          const Divider(height: 0, color: pgInkFaint),
          // Neues-Projekt-Button als prominentes element
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
            leading: Container(
              width: 26, height: 26,
              decoration: BoxDecoration(
                color: pgInk,
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Icon(Icons.add, color: pgPaper, size: 18),
            ),
            title: const Text('neues projekt',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            subtitle: const Text('mit lokalem pfad am PC',
              style: TextStyle(fontFamily: 'monospace', fontSize: 11, color: pgInkSoft)),
            onTap: () async {
              Navigator.pop(context);
              await Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const NewProjectScreen()),
              );
            },
          ),
          const Divider(height: 0, color: pgInkFaint, indent: 20, endIndent: 20),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
            child: TextButton.icon(
              onPressed: () { Navigator.pop(context); _logoutPrompt(context, client); },
              icon: const Icon(Icons.logout, size: 16, color: pgInkSoft),
              label: const Text('verbindung trennen',
                style: TextStyle(color: pgInkSoft, fontFamily: 'monospace', fontSize: 12)),
            ),
          ),
        ],
      ),
    );
  }

  void _logoutPrompt(BuildContext context, SyncClient client) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: pgPaper,
        title: const Text('verbindung trennen?'),
        content: const Text('die session wird beendet. ein neues pairing ist nötig.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('abbrechen', style: TextStyle(color: pgInk))),
          TextButton(
            onPressed: () { Navigator.pop(context); client.logout(); },
            child: const Text('trennen', style: TextStyle(color: pgDanger)),
          ),
        ],
      ),
    );
  }
}
