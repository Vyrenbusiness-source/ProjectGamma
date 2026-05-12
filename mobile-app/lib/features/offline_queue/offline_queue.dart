/// Pure-dart Offline-Queue für optimistisches UI.
/// Aktionen (z.b. CREATE_IDEA) werden lokal angenommen, sofort als
/// `pending` sichtbar und vom sync-client beim nächsten Connect gedrained.
/// Keine Flutter-Imports — testbar ohne widget-tester.
///
/// Persistenz übernimmt der Aufrufer via [toJson]/[fromJson]
/// (z.b. SharedPreferences/Hive). Dieses Modul kennt nur in-memory state.
library;

enum QueueStatus { pending, sent, failed }

class QueueItem {
  QueueItem({
    required this.id,
    required this.type,
    required this.payload,
    required this.createdAt,
    this.status = QueueStatus.pending,
    this.retryCount = 0,
    this.error,
  });

  final String id;
  final String type;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
  QueueStatus status;
  int retryCount;
  String? error;

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'payload': payload,
        'createdAt': createdAt.toIso8601String(),
        'status': status.name,
        'retryCount': retryCount,
        if (error != null) 'error': error,
      };

  static QueueItem fromJson(Map<String, dynamic> j) => QueueItem(
        id: j['id'] as String,
        type: j['type'] as String,
        payload: Map<String, dynamic>.from(j['payload'] as Map),
        createdAt: DateTime.parse(j['createdAt'] as String),
        status: QueueStatus.values.firstWhere(
          (s) => s.name == j['status'],
          orElse: () => QueueStatus.pending,
        ),
        retryCount: (j['retryCount'] as num?)?.toInt() ?? 0,
        error: j['error'] as String?,
      );
}

/// In-memory Offline-Queue. Reihenfolge in [list]: neueste zuerst.
class OfflineQueue {
  OfflineQueue({this.max = 200, DateTime Function()? now})
      : _now = now ?? DateTime.now;

  final int max;
  final DateTime Function() _now;
  final List<QueueItem> _items = [];
  int _seq = 0;

  /// Lokale id — gerätelokal, nicht über sync_server gespiegelt.
  String _newId() {
    _seq += 1;
    return 'oq_${_now().microsecondsSinceEpoch}_$_seq';
  }

  /// Fügt eine neue Aktion in den pending-state ein und gibt das Item
  /// für optimistisches UI-Rendering zurück.
  QueueItem enqueue({
    required String type,
    required Map<String, dynamic> payload,
  }) {
    if (type.isEmpty) {
      throw ArgumentError.value(type, 'type', 'darf nicht leer sein');
    }
    final item = QueueItem(
      id: _newId(),
      type: type,
      payload: Map<String, dynamic>.from(payload),
      createdAt: _now(),
    );
    _items.insert(0, item);
    _enforceCap();
    return item;
  }

  void _enforceCap() {
    if (_items.length <= max) return;
    // Strikt auf `max` cappen, pending bevorzugen — analog zu desktop-app/offline_queue.js.
    // Reihenfolge: neueste zuerst (insert(0,...)). Wir behalten alle pending,
    // füllen mit other (sent/failed) auf bis cap voll.
    final pending = <QueueItem>[];
    final other = <QueueItem>[];
    for (final i in _items) {
      if (i.status == QueueStatus.pending) {
        pending.add(i);
      } else {
        other.add(i);
      }
    }
    _items.clear();
    if (pending.length >= max) {
      // Nur pending → ältere droppen (data-loss möglich; UI warnt via badge).
      _items.addAll(pending.take(max));
    } else {
      _items
        ..addAll(pending)
        ..addAll(other.take(max - pending.length));
    }
  }

  List<QueueItem> get list => List.unmodifiable(_items);

  List<QueueItem> get pending =>
      _items.where((i) => i.status == QueueStatus.pending).toList();

  /// Liefert pending in chronologischer Reihenfolge (älteste zuerst).
  List<QueueItem> drainPending() => pending.reversed.toList();

  void markSent(String id) {
    final i = _byId(id);
    if (i == null) return;
    i.status = QueueStatus.sent;
    i.error = null;
    _enforceCap();
  }

  void markFailed(String id, String error) {
    final i = _byId(id);
    if (i == null) return;
    i.status = QueueStatus.failed;
    i.error = error;
    i.retryCount += 1;
  }

  void retry(String id) {
    final i = _byId(id);
    if (i == null) return;
    i.status = QueueStatus.pending;
    i.error = null;
  }

  void drop(String id) => _items.removeWhere((i) => i.id == id);

  void clear() => _items.clear();

  QueueItem? _byId(String id) {
    for (final i in _items) {
      if (i.id == id) return i;
    }
    return null;
  }

  Map<String, dynamic> toJson() => {
        'items': _items.map((i) => i.toJson()).toList(),
      };

  static OfflineQueue fromJson(Map<String, dynamic> j) {
    final q = OfflineQueue();
    final raw = (j['items'] as List?) ?? const [];
    for (final r in raw) {
      q._items.add(QueueItem.fromJson(Map<String, dynamic>.from(r as Map)));
    }
    return q;
  }
}
