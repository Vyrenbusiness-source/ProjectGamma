import 'package:flutter/material.dart';
import '../../theme.dart';

/// Mini-HTML-Renderer: erkennt <i>, <code>, <b> und HTML-entities — kein full parser.
class CloudStripHtml extends StatelessWidget {
  final String html;
  const CloudStripHtml({super.key, required this.html});

  @override
  Widget build(BuildContext context) {
    final spans = <InlineSpan>[];
    final regex = RegExp(r'(<i>|</i>|<code>|</code>|<b>|</b>)');
    int pos = 0;
    bool italic = false, mono = false, bold = false;
    String dec(String s) => s
        .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"').replaceAll('&#39;', "'");
    TextSpan t(String s) => TextSpan(text: dec(s), style: TextStyle(
      fontStyle: italic ? FontStyle.italic : null,
      fontFamily: mono ? 'monospace' : null,
      fontWeight: bold ? FontWeight.w600 : null,
    ));
    for (final m in regex.allMatches(html)) {
      if (m.start > pos) spans.add(t(html.substring(pos, m.start)));
      switch (m.group(0)) {
        case '<i>': italic = true; break;
        case '</i>': italic = false; break;
        case '<code>': mono = true; break;
        case '</code>': mono = false; break;
        case '<b>': bold = true; break;
        case '</b>': bold = false; break;
      }
      pos = m.end;
    }
    if (pos < html.length) spans.add(t(html.substring(pos)));
    return RichText(text: TextSpan(
      style: const TextStyle(fontSize: 12, color: pgInk, height: 1.4),
      children: spans,
    ));
  }
}
