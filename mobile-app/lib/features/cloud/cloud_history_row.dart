import 'package:flutter/material.dart';
import '../../theme.dart';
import 'cloud_glyphs.dart';
import 'cloud_strip_html.dart';

/// Eine zeile im sync-verlauf: source-icon, text (mini-html), rel-zeit.
class CloudHistoryRow extends StatelessWidget {
  final Map<String, dynamic> entry;
  const CloudHistoryRow({super.key, required this.entry});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 24, child: Text(
          cloudSourceIcon(entry['source']?.toString()),
          style: const TextStyle(
            fontFamily: 'monospace', fontSize: 11, color: pgInkSoft))),
        const SizedBox(width: 4),
        Expanded(child: CloudStripHtml(html: entry['text']?.toString() ?? '')),
        const SizedBox(width: 4),
        Text(cloudRelTime(entry['ts'] as int?),
          style: const TextStyle(
            fontFamily: 'monospace', fontSize: 9.5, color: pgInkFaint)),
      ]),
    );
  }
}
