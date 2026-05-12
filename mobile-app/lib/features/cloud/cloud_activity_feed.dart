import 'package:flutter/material.dart';
import '../../theme.dart';
import 'cloud_glyphs.dart';
import 'cloud_strip_html.dart';

/// Activity-feed für cloud-screen — zeigt top-12 events.
/// Trennt chat/msg-blöcke (multiline) vom operativen event-feed (inline).
class CloudActivityFeed extends StatelessWidget {
  final List<Map<String, dynamic>> activity;
  const CloudActivityFeed({super.key, required this.activity});

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        const PgEyebrow('aktivität'),
        const Spacer(),
        Text('${activity.length} events',
          style: const TextStyle(
            fontFamily: 'monospace', fontSize: 9.5, color: pgInkFaint)),
      ]),
      const SizedBox(height: 4),
      if (activity.isEmpty)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Center(child: Text('— stille —',
            style: TextStyle(color: pgInkFaint, fontSize: 12))),
        )
      else
        Column(children: [
          for (final e in activity.take(12))
            if (e['type'] == 'chat' || e['type'] == 'msg')
              _ChatBlock(event: e)
            else
              _EventLine(event: e),
        ]),
    ]);
  }
}

class _ChatBlock extends StatelessWidget {
  final Map<String, dynamic> event;
  const _ChatBlock({required this.event});
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 9),
      decoration: BoxDecoration(
        color: const Color(0xFFF6F4EE),
        border: Border.all(color: pgInkFaint, width: 1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Text('☁ claude',
            style: TextStyle(
              fontFamily: 'monospace', fontSize: 10,
              color: pgInkSoft, letterSpacing: 0.5)),
          const Spacer(),
          Text(cloudRelTime(event['ts'] as int?),
            style: const TextStyle(
              fontFamily: 'monospace', fontSize: 9.5, color: pgInkFaint)),
        ]),
        const SizedBox(height: 4),
        CloudStripHtml(html: event['text']?.toString() ?? ''),
      ]),
    );
  }
}

class _EventLine extends StatelessWidget {
  final Map<String, dynamic> event;
  const _EventLine({required this.event});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 14, child: Text(cloudGlyph(event['type']?.toString()),
          style: const TextStyle(
            fontFamily: 'monospace', fontSize: 11, color: pgInkSoft))),
        const SizedBox(width: 6),
        Expanded(child: CloudStripHtml(html: event['text']?.toString() ?? '')),
        const SizedBox(width: 4),
        Text(cloudRelTime(event['ts'] as int?),
          style: const TextStyle(
            fontFamily: 'monospace', fontSize: 9.5, color: pgInkFaint)),
      ]),
    );
  }
}
