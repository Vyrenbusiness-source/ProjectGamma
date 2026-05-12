import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/notifications/notifications_inbox.dart';

Map<String, dynamic> _n(String id, {String type = 'cc_done'}) => {
      'id': id,
      'type': type,
      'title': 't',
      'body': 'b',
      'projectId': 'p1',
      'priority': 'normal',
      'createdAt': '2026-05-10T00:00:00.000Z',
    };

void main() {
  test('push dedupliziert per id und respektiert max-cap', () {
    final inbox = NotificationsInbox(max: 3);
    inbox.push(_n('a'));
    inbox.push(_n('b'));
    inbox.push(_n('a'));
    expect(inbox.list.map((e) => e['id']).toList(), ['a', 'b']);
    inbox.push(_n('c'));
    inbox.push(_n('d'));
    expect(inbox.list.map((e) => e['id']).toList(), ['d', 'c', 'a']);
  });

  test('unreadCount + markRead', () {
    final inbox = NotificationsInbox();
    inbox.push(_n('a'));
    inbox.push(_n('b'));
    expect(inbox.unreadCount, 2);
    inbox.markRead('a');
    expect(inbox.unreadCount, 1);
    inbox.markAllRead();
    expect(inbox.unreadCount, 0);
  });

  test('invalid input wird ignoriert', () {
    final inbox = NotificationsInbox();
    expect(inbox.push(null), isFalse);
    expect(inbox.push({'id': 'x'}), isFalse);
    expect(inbox.list.length, 0);
  });
}
