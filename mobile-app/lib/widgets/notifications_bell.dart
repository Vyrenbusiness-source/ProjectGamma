// NotificationsBell · Glocken-Icon im MainShell-AppBar.
// Zeigt einen Badge mit der Anzahl ungelesener Push-Notifications, öffnet
// auf Tap ein Bottom-Sheet mit der Liste der gespeicherten Einträge.

import 'package:flutter/material.dart';
import '../theme.dart';
import '../sync_client.dart';

class NotificationsBell extends StatelessWidget {
  const NotificationsBell({super.key});

  static String _relTime(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final t = DateTime.tryParse(iso);
    if (t == null) return '—';
    final s = DateTime.now().difference(t).inSeconds;
    if (s < 5) return 'jetzt';
    if (s < 60) return '${s}s';
    if (s < 3600) return '${s ~/ 60}m';
    if (s < 86400) return '${s ~/ 3600}h';
    return '${s ~/ 86400}d';
  }

  static String _glyph(String type) => switch (type) {
        'cc.done' || 'check' => '✓',
        'cc.bug' || 'bug'    => '🐞',
        'cc.rule' || 'rule'  => '⚖',
        'cc.error' || 'warn' => '!',
        _                    => '•',
      };

  void _open(BuildContext context, SyncClient client) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: pgPaper,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (sheetCtx) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.6,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          builder: (_, scrollCtrl) {
            return AnimatedBuilder(
              animation: client,
              builder: (_, __) {
                final items = client.notifications.list;
                final unread = client.notifications.unreadCount;
                return Padding(
                  padding: const EdgeInsets.fromLTRB(0, 8, 0, 16),
                  child: Column(
                    children: [
                      Container(
                        width: 40, height: 4,
                        margin: const EdgeInsets.symmetric(vertical: 8),
                        color: pgInkFaint,
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 4, 12, 8),
                        child: Row(children: [
                          const PgEyebrow('benachrichtigungen'),
                          const SizedBox(width: 8),
                          if (unread > 0) Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(color: pgInk, borderRadius: BorderRadius.circular(8)),
                            child: Text('$unread',
                              style: const TextStyle(color: pgPaper, fontSize: 10, fontFamily: 'monospace', fontWeight: FontWeight.w600)),
                          ),
                          const Spacer(),
                          if (items.isNotEmpty) TextButton(
                            onPressed: () { client.notifications.markAllRead(); client.notifyAll(); },
                            child: const Text('alle gelesen', style: TextStyle(color: pgInk, fontSize: 12)),
                          ),
                          if (items.isNotEmpty) TextButton(
                            onPressed: () { client.notifications.clear(); client.notifyAll(); },
                            child: const Text('leeren', style: TextStyle(color: pgDanger, fontSize: 12)),
                          ),
                        ]),
                      ),
                      const Divider(height: 0, color: pgInk, thickness: 2),
                      Expanded(
                        child: items.isEmpty
                            ? Center(child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.notifications_off_outlined, size: 48, color: pgInkFaint),
                                    const SizedBox(height: 8),
                                    const Text('keine benachrichtigungen.',
                                      style: TextStyle(color: pgInkSoft)),
                                    const SizedBox(height: 4),
                                    const Text('hier landen cc-fertig-events, bugs und regel-vorschläge.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(color: pgInkFaint, fontSize: 11)),
                                  ],
                                ),
                              ))
                            : ListView.separated(
                                controller: scrollCtrl,
                                padding: const EdgeInsets.symmetric(vertical: 4),
                                itemCount: items.length,
                                separatorBuilder: (_, __) =>
                                    const Divider(height: 0, color: pgInkFaint, indent: 20, endIndent: 20),
                                itemBuilder: (_, i) {
                                  final n = items[i];
                                  final isUnread = !client.notifications.isRead(n['id'] as String);
                                  return InkWell(
                                    onTap: () { client.notifications.markRead(n['id'] as String); client.notifyAll(); },
                                    onLongPress: () { client.notifications.drop(n['id'] as String); client.notifyAll(); },
                                    child: Container(
                                      padding: const EdgeInsets.fromLTRB(20, 12, 16, 12),
                                      color: isUnread ? pgPaper2 : Colors.transparent,
                                      child: Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          SizedBox(width: 22, child: Text(
                                            _glyph(n['type']?.toString() ?? ''),
                                            style: const TextStyle(fontSize: 14),
                                          )),
                                          const SizedBox(width: 6),
                                          Expanded(child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(n['title']?.toString() ?? '—',
                                                style: TextStyle(
                                                  fontSize: 13.5,
                                                  fontWeight: isUnread ? FontWeight.w700 : FontWeight.w500,
                                                ),
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis),
                                              const SizedBox(height: 2),
                                              Text(n['body']?.toString() ?? '',
                                                style: const TextStyle(fontSize: 12, color: pgInkSoft, height: 1.35),
                                                maxLines: 3,
                                                overflow: TextOverflow.ellipsis),
                                            ],
                                          )),
                                          const SizedBox(width: 8),
                                          Text(_relTime(n['createdAt']?.toString()),
                                            style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: pgInkFaint)),
                                        ],
                                      ),
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final unread = client.notifications.unreadCount;
    return Stack(
      alignment: Alignment.center,
      clipBehavior: Clip.none,
      children: [
        IconButton(
          icon: Icon(unread > 0 ? Icons.notifications_active : Icons.notifications_none, color: pgInk),
          tooltip: 'benachrichtigungen',
          onPressed: () => _open(context, client),
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
        ),
        if (unread > 0) Positioned(
          right: 0, top: 2,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            constraints: const BoxConstraints(minWidth: 16),
            decoration: BoxDecoration(
              color: pgDanger,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: pgPaper, width: 1.5),
            ),
            child: Text(unread > 9 ? '9+' : '$unread',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w700, fontFamily: 'monospace')),
          ),
        ),
      ],
    );
  }
}
