// SystemPush · zeigt PUSH_NOTIFICATION-Events vom Server als lokale
// System-Benachrichtigung an. Singleton, lazy initialisiert. Best-effort:
// wenn das Plugin failed (z.B. fehlende Permission auf Android 13+), wird
// die in-App-Inbox trotzdem weiter befüllt — der UI-Pfad ist nicht gekoppelt.

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class SystemPush {
  SystemPush._();
  static final instance = SystemPush._();

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _initialized = false;
  bool _suppressOnce = true; // erstes Replay nach Connect nicht spammen

  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    try {
      await _plugin.initialize(const InitializationSettings(android: androidInit));
      final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
      await android?.requestNotificationsPermission();
    } catch (e) {
      if (kDebugMode) debugPrint('[system_push] init failed: $e');
    }
  }

  /// Wird vom SyncClient pro frisch eingegangenem PUSH_NOTIFICATION-Frame
  /// aufgerufen. Liefert eine eindeutige Notification-ID-Hash anhand der
  /// Server-ID, damit Re-Pushes derselben id nicht zu Doppel-Pings führen.
  Future<void> show(Map<String, dynamic> n) async {
    if (_suppressOnce) {
      _suppressOnce = false;
      return;
    }
    if (!_initialized) await init();
    final id = (n['id']?.toString() ?? '').hashCode;
    final title = n['title']?.toString() ?? 'ProjectGamma';
    final body = n['body']?.toString() ?? '';
    final priority = n['priority']?.toString() ?? 'normal';
    final imp = priority == 'high' ? Importance.high : Importance.defaultImportance;
    final prio = priority == 'high' ? Priority.high : Priority.defaultPriority;
    final details = NotificationDetails(
      android: AndroidNotificationDetails(
        'projectgamma_cc',
        'Cloud-Code Status',
        channelDescription: 'Benachrichtigungen wenn Cloud-Code fertig wird, Bugs/Regeln findet oder Fehler auftreten',
        importance: imp,
        priority: prio,
        icon: '@mipmap/ic_launcher',
      ),
    );
    try {
      await _plugin.show(id, title, body.length > 240 ? '${body.substring(0, 240)}…' : body, details);
    } catch (e) {
      if (kDebugMode) debugPrint('[system_push] show failed: $e');
    }
  }
}
