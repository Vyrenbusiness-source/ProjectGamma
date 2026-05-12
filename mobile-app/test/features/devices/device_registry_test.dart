import 'package:flutter_test/flutter_test.dart';
import 'package:projectgamma_mobile/features/devices/device_registry.dart';

const now = 1700000000000;

void main() {
  group('liveStatus', () {
    test('online/away/offline buckets', () {
      expect(liveStatus(now - 30_000, now), DeviceStatus.online);
      expect(liveStatus(now - 2 * 60_000, now), DeviceStatus.away);
      expect(liveStatus(now - 10 * 60_000, now), DeviceStatus.offline);
      expect(liveStatus(null, now), DeviceStatus.offline);
    });
  });

  test('statusLabel mappt deutsch', () {
    expect(statusLabel(DeviceStatus.online), 'online');
    expect(statusLabel(DeviceStatus.away), 'abwesend');
    expect(statusLabel(DeviceStatus.offline), 'offline');
  });

  test('formatRelative rundet menschlich', () {
    expect(formatRelative(now - 10_000, now), 'gerade eben');
    expect(formatRelative(now - 5 * 60_000, now), '5 min');
    expect(formatRelative(now - 3 * 3_600_000, now), '3 std');
    expect(formatRelative(0, now), '—');
    expect(formatRelative(null, now), '—');
  });

  test('refreshStatuses berechnet status neu anhand now', () {
    final list = [
      {'token': 'a', 'lastSeen': now - 5000, 'status': 'offline'},
      {'token': 'b', 'lastSeen': now - 10 * 60_000, 'status': 'online'},
    ];
    final out = refreshStatuses(list, now);
    expect(out[0]['status'], 'online');
    expect(out[1]['status'], 'offline');
  });

  group('canRevoke', () {
    final me = {'deviceType': 'desktop'};
    test('desktop darf fremde geräte trennen', () {
      expect(canRevoke({'token': 't', 'isMe': false}, me), isTrue);
    });
    test('eigene session ist tabu', () {
      expect(canRevoke({'token': 't', 'isMe': true}, me), isFalse);
    });
    test('ohne token nicht möglich', () {
      expect(canRevoke({'token': null, 'isMe': false}, me), isFalse);
      expect(canRevoke({'token': '', 'isMe': false}, me), isFalse);
    });
    test('mobile darf gar nicht', () {
      expect(canRevoke({'token': 't', 'isMe': false}, {'deviceType': 'mobile'}), isFalse);
    });
  });
}
