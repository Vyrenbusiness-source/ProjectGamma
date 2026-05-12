// ConnectionDot · zeigt den Live/Offline-Status der Sync-Verbindung.
// Statt fixer Pixel-Width: ein unsichtbarer "offline"-Phantom-Text reserviert
// die maximal benötigte Breite. So gibt es weder Hüpfen beim Wechsel
// live ↔ offline, noch Overflow auf Geräten mit breiterem Default-Mono-Font.

import 'package:flutter/material.dart';
import '../theme.dart';

class ConnectionDot extends StatelessWidget {
  final bool connected;
  const ConnectionDot({super.key, required this.connected});

  static const _textStyle = TextStyle(
    fontFamily: 'monospace',
    fontSize: 9.5,
    color: pgInkSoft,
    letterSpacing: 0.4,
  );

  @override
  Widget build(BuildContext context) {
    final label = connected ? 'live' : 'offline';
    return Tooltip(
      message: label,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          border: Border.all(color: pgInk, width: 1.5),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: connected ? pgInk : pgInkFaint,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 6),
            // Phantom-Sizing: Stack reserviert Breite anhand des längeren
            // Worts ("offline"), echter Text liegt darüber.
            Stack(
              alignment: Alignment.centerLeft,
              children: [
                const Opacity(
                  opacity: 0.0,
                  child: Text('offline', maxLines: 1, style: _textStyle),
                ),
                Text(label, maxLines: 1, style: _textStyle),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
