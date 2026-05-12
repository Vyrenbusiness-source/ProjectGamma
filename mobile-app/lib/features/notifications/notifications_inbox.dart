/// Pure-dart in-memory Inbox für PUSH_NOTIFICATION-Events vom sync-server.
/// Keine Flutter-Imports — testbar ohne widget-tester.
///
/// Items sind die rohen Maps aus sync-server/lib/notify_dispatch.js
/// (Felder: id, type, title, body, projectId, priority, createdAt).
/// Reihenfolge in [list]: neueste zuerst. Re-push gleicher id bringt das
/// Item nach vorne ohne Read-Status zu resetten.
class NotificationsInbox {
  NotificationsInbox({this.max = 50});

  final int max;
  final List<Map<String, dynamic>> _items = [];
  final Set<String> _read = <String>{};

  static const _required = ['id', 'type', 'title', 'body', 'createdAt'];

  bool _isValid(Object? raw) {
    if (raw is! Map) return false;
    for (final k in _required) {
      final v = raw[k];
      if (v is! String || v.isEmpty) return false;
    }
    return true;
  }

  bool push(Object? raw) {
    if (!_isValid(raw)) return false;
    final item = Map<String, dynamic>.from(raw as Map);
    final id = item['id'] as String;
    _items.removeWhere((x) => x['id'] == id);
    _items.insert(0, item);
    while (_items.length > max) {
      final dropped = _items.removeLast();
      _read.remove(dropped['id']);
    }
    return true;
  }

  List<Map<String, dynamic>> get list => List.unmodifiable(_items);

  int get unreadCount =>
      _items.where((x) => !_read.contains(x['id'])).length;

  bool isRead(String id) => _read.contains(id);

  void markRead(String id) {
    if (_items.any((x) => x['id'] == id)) _read.add(id);
  }

  void markAllRead() {
    for (final x in _items) {
      _read.add(x['id'] as String);
    }
  }

  void drop(String id) {
    _items.removeWhere((x) => x['id'] == id);
    _read.remove(id);
  }

  void clear() {
    _items.clear();
    _read.clear();
  }
}
