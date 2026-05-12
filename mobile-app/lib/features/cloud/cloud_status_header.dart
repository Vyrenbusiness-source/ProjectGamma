import 'package:flutter/material.dart';
import '../../theme.dart';

/// Status-zeile oben im cloud-screen: running-dot, budget, pause/fortsetzen-toggle,
/// optionaler in-progress-titel, claude-api-limit-banner.
class CloudStatusHeader extends StatelessWidget {
  final bool ccRunning;
  final Map<String, dynamic>? budget;
  final List<Map<String, dynamic>> inProgress;
  final bool limitHit;
  final String? limitResetText;
  final VoidCallback onToggle;
  const CloudStatusHeader({
    super.key,
    required this.ccRunning,
    required this.budget,
    required this.inProgress,
    required this.limitHit,
    required this.limitResetText,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Container(
          width: 8, height: 8,
          decoration: BoxDecoration(
            color: ccRunning ? pgInk : pgInkFaint, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(ccRunning ? 'auto-pump aktiv' : 'pausiert',
          style: const TextStyle(
            fontFamily: 'monospace', fontSize: 11, color: pgInkSoft)),
        const SizedBox(width: 8),
        if (budget != null) Text(
          '· \$${(budget!['totalCostUsd'] as num? ?? 0).toStringAsFixed(2)}',
          style: const TextStyle(
            fontFamily: 'monospace', fontSize: 11, color: pgInkFaint),
        ),
        const Spacer(),
        GestureDetector(
          onTap: onToggle,
          child: Text(ccRunning ? 'pause' : 'fortsetzen',
            style: const TextStyle(
              fontFamily: 'monospace', fontSize: 11, color: pgInk,
              decoration: TextDecoration.underline)),
        ),
      ]),
      if (inProgress.isNotEmpty) ...[
        const SizedBox(height: 6),
        Text('▸ ${inProgress.first['title']}',
          style: const TextStyle(fontSize: 12, color: pgInkSoft, height: 1.4),
          maxLines: 2, overflow: TextOverflow.ellipsis),
      ],
      if (limitHit) ...[
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF3E0),
            border: Border.all(color: const Color(0xFFCC8800), width: 1.5),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(children: [
            const Icon(Icons.warning_amber_rounded,
              size: 18, color: Color(0xFFCC8800)),
            const SizedBox(width: 8),
            Expanded(child: Text(
              limitResetText != null
                ? 'claude-api limit erreicht · setzt fort um $limitResetText'
                : 'claude-api limit erreicht · weitere runs schlagen fehl',
              style: const TextStyle(fontSize: 12, height: 1.4),
            )),
          ]),
        ),
      ],
    ]);
  }
}
