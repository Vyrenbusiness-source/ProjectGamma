/// Offline-Queue-Badge: zeigt pending-count + dropdown-liste mit retry/drop.
/// Reagiert auf [MediaQuery.disableAnimations] (analog prefers-reduced-motion).
library;

import 'package:flutter/material.dart';
import '../sync_client.dart';
import '../features/offline_queue/offline_queue.dart';

class OfflineQueueBadge extends StatelessWidget {
  const OfflineQueueBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final client = SyncClientScope.of(context);
    final pending = client.offlineQueue.pending.length;
    final failed = client.offlineQueue.list
        .where((i) => i.status == QueueStatus.failed)
        .length;
    final total = pending + failed;
    if (total == 0) return const SizedBox.shrink();
    return Tooltip(
      message: 'offline-warteschlange',
      child: TextButton.icon(
        icon: const Icon(Icons.cloud_off, size: 18),
        label: Text('$total'),
        onPressed: () => _open(context, client),
      ),
    );
  }

  void _open(BuildContext context, SyncClient client) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => _OfflineQueueSheet(client: client),
    );
  }
}

class _OfflineQueueSheet extends StatefulWidget {
  const _OfflineQueueSheet({required this.client});
  final SyncClient client;

  @override
  State<_OfflineQueueSheet> createState() => _OfflineQueueSheetState();
}

class _OfflineQueueSheetState extends State<_OfflineQueueSheet> {
  @override
  void initState() {
    super.initState();
    widget.client.addListener(_onChange);
  }

  @override
  void dispose() {
    widget.client.removeListener(_onChange);
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.client.offlineQueue.list
        .where((i) => i.status != QueueStatus.sent)
        .toList();
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('offline-warteschlange',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            if (items.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('keine pending aktionen'),
              )
            else
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 360),
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (_, i) => _row(items[i]),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _row(QueueItem item) {
    final failed = item.status == QueueStatus.failed;
    return ListTile(
      dense: true,
      leading: Icon(failed ? Icons.error_outline : Icons.schedule, size: 18),
      title: Text(item.type),
      subtitle: failed && item.error != null
          ? Text(item.error!, maxLines: 2, overflow: TextOverflow.ellipsis)
          : Text('pending · ${item.createdAt.toIso8601String()}'),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: 'erneut versuchen',
            icon: const Icon(Icons.refresh, size: 18),
            onPressed: () => widget.client.retryQueueItem(item.id),
          ),
          IconButton(
            tooltip: 'verwerfen',
            icon: const Icon(Icons.delete_outline, size: 18),
            onPressed: () => widget.client.dropQueueItem(item.id),
          ),
        ],
      ),
    );
  }
}
