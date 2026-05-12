import 'package:flutter/material.dart';
import '../../theme.dart';

/// Eine zeile in der geräte-section: name, live-status, optional revoke-button.
class CloudDeviceRow extends StatelessWidget {
  final Map<String, dynamic> session;
  final VoidCallback onRemove;
  const CloudDeviceRow({super.key, required this.session, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    final isMe = session['isMe'] == true;
    final type = session['deviceType']?.toString() ?? '?';
    final name = session['deviceName']?.toString() ?? '?';
    final lastSeen = session['lastSeen'] as int?;
    final live = lastSeen != null &&
        (DateTime.now().millisecondsSinceEpoch - lastSeen) < 60000;
    final icon = type == 'mobile' ? '📱' : type == 'desktop' ? '💻' : '☁';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Text(icon, style: const TextStyle(fontSize: 18)),
        const SizedBox(width: 10),
        Expanded(child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('$name${isMe ? " · this" : ""}',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
            const SizedBox(height: 1),
            Row(children: [
              Container(width: 5, height: 5,
                decoration: BoxDecoration(
                  color: live ? pgInk : pgInkFaint, shape: BoxShape.circle)),
              const SizedBox(width: 4),
              Text(
                live ? 'live' : (lastSeen == null
                  ? '—'
                  : '${(DateTime.now().millisecondsSinceEpoch - lastSeen) ~/ 60000}m'),
                style: const TextStyle(
                  fontSize: 10, color: pgInkSoft, fontFamily: 'monospace'),
              ),
            ]),
          ],
        )),
        if (!isMe && session['token'] != null)
          IconButton(
            icon: const Icon(Icons.close, size: 16, color: pgDanger),
            onPressed: onRemove,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 26, minHeight: 26),
          ),
      ]),
    );
  }
}
