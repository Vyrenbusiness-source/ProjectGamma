/// Pro-Projekt Geräte-Panel · Mobile.
/// Zeigt verbundene Geräte mit Live-Status (online/abwesend/offline) und
/// letzter Projekt-Aktivität. Quelle: GET /api/projects/:id/devices.
/// Tick alle 15 s, damit "online → abwesend" ohne re-fetch sichtbar wird.
/// Revoke-Button bleibt aus (mobile sieht keine fremden tokens).
library;

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../sync_client.dart';
import 'device_registry.dart';

class DevicePanel extends StatefulWidget {
  const DevicePanel({super.key});
  @override
  State<DevicePanel> createState() => _DevicePanelState();
}

class _DevicePanelState extends State<DevicePanel> {
  List<Map<String, dynamic>> _devices = const [];
  String? _error;
  Timer? _tick;
  String? _lastProjectId;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 15), (_) => _load());
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    final c = SyncClientScope.of(context, listen: false);
    final p = c.activeProject;
    final url = c.serverUrl;
    if (p == null || url == null) return;
    _lastProjectId = p['id'] as String?;
    try {
      final r = await http.get(
        Uri.parse('$url/api/projects/${p['id']}/devices'),
        headers: c.authHeader,
      ).timeout(const Duration(seconds: 4));
      if (r.statusCode != 200) throw Exception('http ${r.statusCode}');
      final data = jsonDecode(r.body) as Map<String, dynamic>;
      final list = ((data['devices'] as List?) ?? const [])
          .cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() { _devices = list; _error = null; });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final view = refreshStatuses(_devices, now);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.black26),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('// geräte · ${view.length} verbunden',
              style: const TextStyle(fontFamily: 'monospace', fontSize: 11)),
          if (_error != null)
            Padding(padding: const EdgeInsets.only(top: 4),
                child: Text('fehler: $_error',
                    style: const TextStyle(color: Colors.red, fontSize: 11))),
          const SizedBox(height: 6),
          if (view.isEmpty && _error == null)
            const Text('keine geräte gefunden.',
                style: TextStyle(fontSize: 12, color: Colors.black54))
          else
            ...view.map((d) => _row(d, now)),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> d, int now) {
    final status = d['status'] as String? ?? 'offline';
    final color = status == 'online'
        ? const Color(0xFF22AA88)
        : (status == 'away' ? const Color(0xFFCC9900) : Colors.black26);
    final ls = d['lastSeen'];
    final la = d['lastActivityInProjectAt'];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(children: [
        Container(width: 8, height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 8),
        Expanded(child: Text.rich(TextSpan(children: [
          TextSpan(text: d['deviceName']?.toString() ?? '',
              style: const TextStyle(fontWeight: FontWeight.bold)),
          TextSpan(text: ' (${d['deviceType']}'
              '${d['isMe'] == true ? ' · dieses gerät' : ''})',
              style: const TextStyle(fontSize: 11, color: Colors.black54)),
        ]))),
        Text('${statusLabel(status)} · '
            '${formatRelative(ls is int ? ls : null, now)}',
            style: const TextStyle(fontSize: 11, color: Colors.black54)),
        if (la is int) Padding(
          padding: const EdgeInsets.only(left: 6),
          child: Text('· ${formatRelative(la, now)}',
              style: const TextStyle(fontSize: 10, color: Colors.black45)),
        ),
      ]),
    );
  }
}
